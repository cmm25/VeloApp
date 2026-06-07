"""
WeightedKeypointLoss — kinetic-chain weighting for tennis pose (P2).

Idea: the standard Ultralytics pose loss (OKS-based) treats all keypoints with
per-keypoint `sigmas` (tolerance). A *smaller* sigma penalises error on that
keypoint harder. We exploit that to bias the gradient toward the joints that
define a tennis stroke — the dominant shoulder, elbow, wrist, hip — and (once
added) the racket butt/tip. No need to rewrite the loss forward pass; we just
reshape the sigma vector. Minimal blast radius, real effect.

This is a P2 module. It only earns its keep once:
  • the fine-tune already beats the stock baseline on 17 COCO keypoints, AND
  • racket keypoints (idx 17 butt, 18 tip) have been annotated.

Until then, training runs with stock loss (use_weighted_loss=False).

COCO-17 order — see yolo_analyze.py. Lower weight number below = looser
tolerance = less penalised; higher = tighter = penalised harder.
"""

# Per-keypoint emphasis. 1.0 = default tolerance. >1 tightens (penalise harder).
# Heaviest on the dominant kinetic chain; light on face keypoints (irrelevant).
KINETIC_CHAIN_WEIGHTS = {
    "nose": 0.5,
    "left_eye": 0.3, "right_eye": 0.3, "left_ear": 0.3, "right_ear": 0.3,
    "left_shoulder": 1.6, "right_shoulder": 1.6,
    "left_elbow": 1.8, "right_elbow": 1.8,
    "left_wrist": 2.2, "right_wrist": 2.2,     # racket hand — matters most
    "left_hip": 1.6, "right_hip": 1.6,          # rotational axis
    "left_knee": 1.0, "right_knee": 1.0,
    "left_ankle": 0.8, "right_ankle": 0.8,
    # velo19 racket keypoints (dataset idx 17 butt, 18 tip) — ACTIVE for [19,3] training.
    "racket_butt": 2.4, "racket_tip": 2.6,
}

_COCO17 = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]


def _weight_vector(n_kpts: int):
    import torch
    names = list(_COCO17)
    if n_kpts >= 19:  # velo19: idx 17 = racket_butt, idx 18 = racket_tip
        names += ["racket_butt", "racket_tip"] + [f"extra_{i}" for i in range(n_kpts - 19)]
    elif n_kpts > 17:
        names += [f"extra_{i}" for i in range(n_kpts - 17)]
    w = [KINETIC_CHAIN_WEIGHTS.get(names[i], 1.0) for i in range(n_kpts)]
    return torch.tensor(w, dtype=torch.float32)


def patch_weighted_keypoint_loss(model):
    """
    Monkeypatch Ultralytics' KeypointLoss so dominant-chain keypoints are
    penalised harder, by dividing their per-keypoint sigma by the weight
    (smaller sigma ⇒ tighter ⇒ larger loss for the same pixel error).

    Call before model.train(). Safe no-op-ish if the internal API shifts —
    raises a clear error so it never silently does nothing.
    """
    try:
        from ultralytics.utils.loss import KeypointLoss
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"Cannot import KeypointLoss to patch: {e}")

    if getattr(KeypointLoss, "_velo_patched", False):
        return

    orig_init = KeypointLoss.__init__

    def patched_init(self, sigmas):
        orig_init(self, sigmas)
        w = _weight_vector(len(self.sigmas)).to(self.sigmas.device)
        # tighten tolerance on emphasised keypoints
        self.sigmas = self.sigmas / w

    KeypointLoss.__init__ = patched_init
    KeypointLoss._velo_patched = True
