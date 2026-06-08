#!/usr/bin/env python3
"""
Velo — System Design & Architecture document generator.

Produces a single polished, user-facing PDF:

    design/Velo_System_Design.pdf

The document explains Velo at the architecture / flow level — components,
responsibilities, the coaching-session trust flow, the coach and athlete
journeys, deployment topology, and resilience / graceful degradation. It is
deliberately conceptual: no Solidity, no function signatures, no contract
internals. Diagrams are drawn as vector graphics (not raw mermaid text) and
laid out for print on A4.

Usage:
    pip install reportlab
    python design/generate_system_design.py            # writes the PDF into design/
    python design/generate_system_design.py --out DIR  # writes into DIR instead
"""

from __future__ import annotations

import argparse
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)

# ── Brand palette ─────────────────────────────────────────────────────────────
# Mirrors Velo/src/index.css: near-black canvas, chalk type, single amber accent.
INK = colors.HexColor("#0A0A0A")        # near-black canvas (cover / chain band)
INK_SOFT = colors.HexColor("#141210")   # slightly lifted dark panel
CHALK = colors.HexColor("#F4EFE6")      # off-white type
AMBER = colors.HexColor("#F5B14B")      # accent
AMBER_SOFT = colors.HexColor("#C98A2E")
BODY = colors.HexColor("#23201A")       # body type on light pages
MUTED = colors.HexColor("#6B6358")
RULE = colors.HexColor("#D9D1C2")
CARD = colors.HexColor("#F7F3EA")
CARD_LINE = colors.HexColor("#E4DCCB")

# Display / text / mono stand-ins for Fraunces / Inter / JetBrains Mono.
# reportlab ships Times, Helvetica and Courier; the palette carries the brand.
F_DISPLAY = "Times-Bold"
F_DISPLAY_R = "Times-Roman"
F_BODY = "Helvetica"
F_BODY_B = "Helvetica-Bold"
F_MONO = "Courier"

PAGE_W, PAGE_H = A4
MARGIN = 2.0 * cm
CONTENT_W = PAGE_W - 2 * MARGIN


# ── Styles ────────────────────────────────────────────────────────────────────
def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s: dict[str, ParagraphStyle] = {}
    s["CoverKicker"] = ParagraphStyle(
        "CoverKicker", parent=base["Normal"], textColor=AMBER, fontName=F_BODY_B,
        fontSize=11, leading=16, alignment=TA_CENTER, spaceAfter=6, tracking=3,
    )
    s["CoverTitle"] = ParagraphStyle(
        "CoverTitle", parent=base["Title"], textColor=CHALK, fontName=F_DISPLAY,
        fontSize=42, leading=46, alignment=TA_CENTER,
    )
    s["CoverSub"] = ParagraphStyle(
        "CoverSub", parent=base["Normal"], textColor=CHALK, fontName=F_BODY,
        fontSize=12.5, leading=19, alignment=TA_CENTER,
    )
    s["CoverMetaK"] = ParagraphStyle(
        "CoverMetaK", parent=base["Normal"], textColor=AMBER, fontName=F_BODY_B,
        fontSize=10, leading=15, alignment=TA_CENTER,
    )
    s["CoverMetaV"] = ParagraphStyle(
        "CoverMetaV", parent=base["Normal"], textColor=colors.HexColor("#B8B0A2"),
        fontName=F_BODY, fontSize=10, leading=15, alignment=TA_CENTER,
    )
    s["H1"] = ParagraphStyle(
        "H1", parent=base["Heading1"], textColor=BODY, fontName=F_DISPLAY,
        fontSize=21, leading=25, spaceBefore=16, spaceAfter=8,
    )
    s["H2"] = ParagraphStyle(
        "H2", parent=base["Heading2"], textColor=AMBER_SOFT, fontName=F_BODY_B,
        fontSize=12, leading=16, spaceBefore=12, spaceAfter=4, tracking=1,
    )
    s["Body"] = ParagraphStyle(
        "Body", parent=base["Normal"], textColor=BODY, fontName=F_BODY,
        fontSize=10, leading=15.5, spaceAfter=7, alignment=TA_LEFT,
    )
    s["Lead"] = ParagraphStyle(
        "Lead", parent=s["Body"], fontSize=11.5, leading=17.5, spaceAfter=10,
    )
    s["Bullet"] = ParagraphStyle(
        "Bullet", parent=s["Body"], leftIndent=14, bulletIndent=2, spaceAfter=5,
    )
    s["Caption"] = ParagraphStyle(
        "Caption", parent=s["Body"], fontSize=8.5, textColor=MUTED, spaceBefore=4,
        spaceAfter=12,
    )
    s["TOC"] = ParagraphStyle(
        "TOC", parent=s["Body"], fontSize=11, leading=20, textColor=BODY,
    )
    return s


def bullets(items, st):
    return [Paragraph(f"<font color='#C98A2E'>•</font>&nbsp;&nbsp;{t}", st["Bullet"])
            for t in items]


# ── Page furniture ────────────────────────────────────────────────────────────
def _cover_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # faint amber field lines, evoking a court
    canvas.setStrokeColor(colors.HexColor("#1C1710"))
    canvas.setLineWidth(1)
    for i in range(1, 6):
        y = PAGE_H * i / 6
        canvas.line(MARGIN, y, PAGE_W - MARGIN, y)
    # amber rule under the title band
    canvas.setStrokeColor(AMBER)
    canvas.setLineWidth(2)
    canvas.line(PAGE_W / 2 - 3.2 * cm, PAGE_H - 10.1 * cm,
                PAGE_W / 2 + 3.2 * cm, PAGE_H - 10.1 * cm)
    canvas.setFillColor(colors.HexColor("#8C8475"))
    canvas.setFont(F_BODY, 8)
    canvas.drawCentredString(
        PAGE_W / 2, 1.5 * cm,
        "Velo — a verifiable training record, owned by the athlete",
    )
    canvas.restoreState()


def _make_body_bg(label: str):
    def _body_bg(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.6)
        canvas.line(MARGIN, PAGE_H - 1.4 * cm, PAGE_W - MARGIN, PAGE_H - 1.4 * cm)
        canvas.setFillColor(AMBER_SOFT)
        canvas.setFont(F_BODY_B, 8)
        canvas.drawString(MARGIN, PAGE_H - 1.2 * cm, "VELO")
        canvas.setFillColor(MUTED)
        canvas.setFont(F_BODY, 8)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 1.2 * cm, label)
        canvas.setStrokeColor(RULE)
        canvas.line(MARGIN, 1.4 * cm, PAGE_W - MARGIN, 1.4 * cm)
        canvas.setFillColor(MUTED)
        canvas.setFont(F_BODY, 8)
        canvas.drawString(MARGIN, 1.0 * cm, "Autonomous AI coaching · Somnia testnet")
        canvas.drawRightString(PAGE_W - MARGIN, 1.0 * cm, f"{canvas.getPageNumber()}")
        canvas.restoreState()
    return _body_bg


def make_doc(path: str, label: str) -> BaseDocTemplate:
    doc = BaseDocTemplate(
        path, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=2.0 * cm, bottomMargin=2.0 * cm, title=label, author="Velo",
    )
    cover_frame = Frame(MARGIN, 2 * cm, CONTENT_W, PAGE_H - 12 * cm, id="cover")
    body_frame = Frame(MARGIN, 1.7 * cm, CONTENT_W, PAGE_H - 3.4 * cm, id="body")
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=_cover_bg),
        PageTemplate(id="Body", frames=[body_frame], onPage=_make_body_bg(label)),
    ])
    return doc


# ── Low-level drawing primitives ──────────────────────────────────────────────
def _rrect(c, x, y, w, h, r=7, fill=None, stroke=CARD_LINE, lw=0.9):
    if fill is not None:
        c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(lw)
    c.roundRect(x, y, w, h, r, stroke=1 if stroke else 0, fill=1 if fill else 0)


def _text(c, x, y, s, font=F_BODY, size=9, color=BODY, anchor="start"):
    c.setFillColor(color)
    c.setFont(font, size)
    if anchor == "middle":
        c.drawCentredString(x, y, s)
    elif anchor == "end":
        c.drawRightString(x, y, s)
    else:
        c.drawString(x, y, s)


def _fit(c, text, font, size, max_w):
    words = text.split()
    lines, cur = [], ""
    for wd in words:
        trial = (cur + " " + wd).strip()
        if c.stringWidth(trial, font, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def _node(c, x, y, w, h, title, body="", accent=AMBER_SOFT, fill=CARD,
          title_color=BODY, body_color=MUTED, title_size=9.5, body_size=8):
    _rrect(c, x, y, w, h, r=6, fill=fill, stroke=CARD_LINE)
    # accent tab on the left edge
    c.setFillColor(accent)
    c.roundRect(x, y, 4, h, 2, stroke=0, fill=1)
    _text(c, x + 11, y + h - 14, title, font=F_BODY_B, size=title_size,
          color=title_color)
    if body:
        lines = _fit(c, body, F_BODY, body_size, w - 20)
        ty = y + h - 14 - 12
        for ln in lines:
            _text(c, x + 11, ty, ln, font=F_BODY, size=body_size, color=body_color)
            ty -= 10


def _arrow(c, x1, y1, x2, y2, color=AMBER_SOFT, lw=1.3, head=5):
    import math
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.line(x1, y1, x2, y2)
    ang = math.atan2(y2 - y1, x2 - x1)
    c.setFillColor(color)
    c.saveState()
    c.translate(x2, y2)
    c.rotate(math.degrees(ang))
    p = c.beginPath()
    p.moveTo(0, 0)
    p.lineTo(-head * 1.8, head)
    p.lineTo(-head * 1.8, -head)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


class Diagram(Flowable):
    """A fixed-size vector diagram drawn by `fn(canvas, width, height)`."""

    def __init__(self, height, fn, width=CONTENT_W):
        super().__init__()
        self.width = width
        self.height = height
        self.fn = fn

    def wrap(self, *_):
        return (self.width, self.height)

    def draw(self):
        self.fn(self.canv, self.width, self.height)


# ── Diagram 1: layered architecture ───────────────────────────────────────────
def draw_layers(c, W, H):
    layers = [
        ("Frontend dApp", "What coaches and athletes see. Wallet sign-in, video "
         "upload, commissioning a session, and live status.", AMBER),
        ("Agent runner & orchestration", "Always-on service that watches the "
         "chain and drives the agents: form analyst, prescriber, serve "
         "specialist, bounty lead.", AMBER_SOFT),
        ("AI reasoning  +  Vision engine", "Verifiable on-chain inference "
         "(preferred) with a hosted-model fallback, paired with pose / serve "
         "video analysis.", AMBER_SOFT),
        ("On-chain protocol  ·  Somnia", "The source of truth: escrow, signed "
         "receipts, agent directory, the athlete's soulbound record, and the "
         "open bounty market.", colors.HexColor("#E0A23E")),
        ("Storage  ·  IPFS", "Full reports and videos are pinned off-chain; the "
         "chain keeps their fingerprints.", MUTED),
    ]
    n = len(layers)
    gap = 9
    lh = (H - gap * (n - 1)) / n
    y = H - lh
    chain_idx = 3
    for i, (title, body, accent) in enumerate(layers):
        if i == chain_idx:
            _rrect(c, 0, y, W - 96, lh, r=7, fill=INK, stroke=INK)
            c.setFillColor(AMBER)
            c.roundRect(0, y, 4, lh, 2, stroke=0, fill=1)
            _text(c, 14, y + lh - 16, title, font=F_BODY_B, size=10.5, color=AMBER)
            tl = _fit(c, body, F_BODY, 8.2, W - 96 - 26)
            ty = y + lh - 16 - 12
            for ln in tl:
                _text(c, 14, ty, ln, font=F_BODY, size=8.2,
                      color=colors.HexColor("#CFC7B8"))
                ty -= 10.5
        else:
            _node(c, 0, y, W - 96, lh, title, body, accent=accent,
                  title_size=10.5, body_size=8.2)
        y -= lh + gap

    # vertical "source of truth" rail on the right
    rx = W - 80
    _rrect(c, rx, 0, 80, H, r=7, fill=INK_SOFT, stroke=INK_SOFT)
    c.saveState()
    c.translate(rx + 30, H / 2)
    c.rotate(90)
    _text(c, 0, 0, "CHAIN = SOURCE OF TRUTH", font=F_BODY_B, size=9,
          color=AMBER, anchor="middle")
    c.restoreState()
    c.saveState()
    c.translate(rx + 52, H / 2)
    c.rotate(90)
    _text(c, 0, 0, "money & receipts settle here", font=F_BODY, size=7.5,
          color=colors.HexColor("#9A9286"), anchor="middle")
    c.restoreState()
    # downward dependency arrow
    _arrow(c, rx - 12, H - 6, rx - 12, 6, color=RULE, lw=1)


# ── Diagram 2: coaching-session trust flow ────────────────────────────────────
def draw_trust_flow(c, W, H):
    steps = [
        ("1", "Coach commissions a session",
         "Pays once; the fee is locked in on-chain escrow — held by the "
         "protocol, not by any person.",
         "Funds are escrowed, not trusted to a middleman."),
        ("2", "The tape is analysed",
         "The vision engine extracts movement telemetry; an AI agent reasons it "
         "into a structured form report.",
         "The agent signs its result — authorship is provable."),
        ("3", "A training plan is written",
         "A second agent reads the signed analysis and produces drills and "
         "session goals.",
         "The plan is cryptographically chained to that exact analysis."),
        ("4", "Settlement",
         "The contract checks the chain of signed receipts and splits the "
         "payment between the agents that did the work.",
         "Payout happens only when the receipts link up and verify."),
        ("5", "The record is updated",
         "The finished session is appended to the athlete's soulbound history.",
         "Permanent, athlete-owned, and impossible to quietly rewrite."),
    ]
    n = len(steps)
    gap = 10
    sh = (H - gap * (n - 1)) / n
    left_w = W * 0.60
    right_w = W - left_w - 16
    rx = left_w + 16
    y = H - sh
    for i, (num, title, body, proof) in enumerate(steps):
        # left: the action node with a numbered amber disc
        _node(c, 26, y, left_w - 26, sh, title, body, accent=AMBER_SOFT,
              title_size=9.8, body_size=8)
        c.setFillColor(AMBER)
        c.circle(13, y + sh - 13, 11, stroke=0, fill=1)
        _text(c, 13, y + sh - 16.5, num, font=F_BODY_B, size=11, color=INK,
              anchor="middle")
        # right: the trust guarantee captured at this step
        _rrect(c, rx, y, right_w, sh, r=6, fill=colors.HexColor("#FBF4E6"),
               stroke=colors.HexColor("#EAD6AC"))
        c.setFillColor(AMBER_SOFT)
        c.roundRect(rx, y, 4, sh, 2, stroke=0, fill=1)
        _text(c, rx + 11, y + sh - 13, "TRUST", font=F_BODY_B, size=7,
              color=AMBER_SOFT)
        pl = _fit(c, proof, F_BODY, 8, right_w - 20)
        ty = y + sh - 13 - 11
        for ln in pl:
            _text(c, rx + 11, ty, ln, font=F_BODY, size=8, color=BODY)
            ty -= 10
        # connector arrow between steps (down the left column)
        if i < n - 1:
            _arrow(c, 13, y - 1, 13, y - gap + 1, color=AMBER_SOFT, lw=1.2, head=3.5)
        y -= sh + gap


# ── Diagram 3/4: horizontal journey ───────────────────────────────────────────
def _journey(c, W, H, label, steps, accent=AMBER_SOFT):
    _text(c, 0, H - 10, label, font=F_BODY_B, size=9.5, color=accent)
    top = H - 22
    n = len(steps)
    gap = 10
    bw = (W - gap * (n - 1)) / n
    bh = top
    x = 0
    for i, (t, d) in enumerate(steps):
        fill = INK if i == n - 1 else CARD
        tcol = AMBER if i == n - 1 else BODY
        dcol = colors.HexColor("#CFC7B8") if i == n - 1 else MUTED
        stroke = INK if i == n - 1 else CARD_LINE
        _rrect(c, x, 0, bw, bh, r=6, fill=fill, stroke=stroke)
        _text(c, x + bw / 2, bh - 16, f"{i + 1}", font=F_BODY_B, size=9,
              color=accent if i != n - 1 else AMBER, anchor="middle")
        tl = _fit(c, t, F_BODY_B, 8.5, bw - 12)
        ty = bh - 30
        for ln in tl:
            _text(c, x + bw / 2, ty, ln, font=F_BODY_B, size=8.5, color=tcol,
                  anchor="middle")
            ty -= 10
        dl = _fit(c, d, F_BODY, 7.2, bw - 12)
        ty -= 2
        for ln in dl:
            _text(c, x + bw / 2, ty, ln, font=F_BODY, size=7.2, color=dcol,
                  anchor="middle")
            ty -= 8.6
        if i < n - 1:
            _arrow(c, x + bw + 1.5, bh / 2, x + bw + gap - 1.5, bh / 2,
                   color=accent, lw=1.2, head=3.5)
        x += bw + gap


def draw_coach_journey(c, W, H):
    _journey(c, W, H, "COACH", [
        ("Sign in", "Connect a wallet — no account, no password."),
        ("Pick athlete", "Choose an athlete from your roster, or paste a wallet."),
        ("Upload tape", "Add a match or practice video."),
        ("Choose model", "Pick the analysis style, e.g. general or serve."),
        ("Commission", "Pay once; the session starts automatically."),
        ("Watch & review", "Follow progress, then read the verified plan."),
    ])


def draw_athlete_journey(c, W, H):
    _journey(c, W, H, "ATHLETE", [
        ("Sign in", "Connect a wallet to see your home."),
        ("Build roster", "Connect with the coaches you train with."),
        ("Session runs", "Agents analyse and prescribe autonomously."),
        ("Get insights", "Receive drills, goals and biomechanical notes."),
        ("Own your record", "A permanent, verifiable history that's yours."),
    ], accent=AMBER_SOFT)


# ── Diagram 5: deployment topology ────────────────────────────────────────────
def draw_topology(c, W, H):
    # Off-chain boundary (dashed) on the left two-thirds; chain band on the right.
    chain_w = 120
    off_w = W - chain_w - 18
    c.setDash(3, 3)
    _rrect(c, 0, 0, off_w, H, r=8, fill=None, stroke=MUTED, lw=0.9)
    c.setDash()
    _text(c, 10, H - 12, "OFF-CHAIN  ·  replaceable, holds no custody",
          font=F_BODY_B, size=7.5, color=MUTED)

    # nodes inside off-chain
    pad = 12
    col_w = (off_w - pad * 3) / 2
    top = H - 26
    nh = 40
    # row 1
    _node(c, pad, top - nh, col_w, nh, "Browser + wallet",
          "The user's device. Signs every transaction.", accent=AMBER)
    _node(c, pad * 2 + col_w, top - nh, col_w, nh, "Frontend host",
          "Static dApp bundle served to the browser.", accent=AMBER_SOFT)
    # row 2
    r2 = top - nh - 14 - nh
    _node(c, pad, r2, col_w, nh, "Agent runner",
          "Always-on. Watches the chain, runs the agents, submits signed work.",
          accent=AMBER_SOFT)
    _node(c, pad * 2 + col_w, r2, col_w, nh, "Vision engine",
          "Pose / serve video analysis. Reached privately by the runner.",
          accent=AMBER_SOFT)
    # row 3
    r3 = r2 - 14 - nh
    _node(c, pad, r3, col_w, nh, "AI providers",
          "Hosted models used as a fallback when needed.", accent=MUTED)
    _node(c, pad * 2 + col_w, r3, col_w, nh, "IPFS / pinning",
          "Stores full reports and videos off-chain.", accent=MUTED)

    # chain band on the right
    cx = off_w + 18
    _rrect(c, cx, 0, chain_w, H, r=8, fill=INK, stroke=INK)
    c.setFillColor(AMBER)
    c.roundRect(cx, 0, 4, H, 2, stroke=0, fill=1)
    _text(c, cx + 14, H - 14, "ON-CHAIN", font=F_BODY_B, size=9, color=AMBER)
    _text(c, cx + 14, H - 26, "Somnia testnet", font=F_BODY, size=7.5,
          color=colors.HexColor("#CFC7B8"))
    chain_items = [
        "Escrow & settlement",
        "Signed receipts",
        "Agent directory",
        "Athlete soulbound record",
        "Open bounty market",
    ]
    iy = H - 44
    for it in chain_items:
        c.setFillColor(AMBER_SOFT)
        c.circle(cx + 17, iy + 3, 1.6, stroke=0, fill=1)
        for j, ln in enumerate(_fit(c, it, F_BODY, 7.6, chain_w - 30)):
            _text(c, cx + 24, iy - j * 9, ln, font=F_BODY, size=7.6,
                  color=CHALK)
        iy -= 9 * max(1, len(_fit(c, it, F_BODY, 7.6, chain_w - 30))) + 7

    # off-chain reads from / writes to the chain (short arrows across the boundary)
    _arrow(c, off_w + 2, top - nh / 2, cx - 2, top - nh / 2, color=AMBER, lw=1.4)
    _arrow(c, off_w + 2, r2 + nh / 2, cx - 2, r2 + nh / 2, color=AMBER_SOFT, lw=1.4)
    # internal: the runner reaches the vision engine and the AI providers
    _arrow(c, pad + col_w + 1, r2 + nh / 2, pad * 2 + col_w - 1, r2 + nh / 2,
           color=MUTED, lw=1, head=3.5)
    _arrow(c, pad + col_w / 2, r2, pad + col_w / 2, r3 + nh, color=MUTED, lw=1,
           head=3.5)
    # legend in the clear lower area of the off-chain box
    _text(c, pad, 16, "Browser reads + signs  ·  Runner watches + submits signed "
          "work to the chain", font=F_BODY, size=7.4, color=MUTED)


# ── Diagram 6: resilience / graceful degradation ──────────────────────────────
def draw_resilience(c, W, H):
    half = (W - 16) / 2
    row_h = (H - 14) / 2

    # Top-left: dual-path AI
    bx, by, bw, bh = 0, H - row_h, half, row_h
    _rrect(c, bx, by, bw, bh, r=7, fill=CARD, stroke=CARD_LINE)
    _text(c, bx + 12, by + bh - 15, "Verifiable AI, always finishes",
          font=F_BODY_B, size=9.5, color=BODY)
    _node(c, bx + 12, by + 12, (bw - 36) / 2, bh - 40, "On-chain inference",
          "Preferred: consensus-verified, with a receipt.", accent=AMBER,
          title_size=8.5, body_size=7.2)
    _node(c, bx + 24 + (bw - 36) / 2, by + 12, (bw - 36) / 2, bh - 40,
          "Hosted fallback", "Used if the native path is slow or unavailable.",
          accent=MUTED, title_size=8.5, body_size=7.2)
    _arrow(c, bx + 12 + (bw - 36) / 2, by + (bh - 40) / 2 + 12,
           bx + 24 + (bw - 36) / 2, by + (bh - 40) / 2 + 12,
           color=AMBER_SOFT, lw=1.2, head=3.5)
    _text(c, bx + bw / 2, by + 5, "Either way, the path used is recorded.",
          font=F_BODY, size=7, color=MUTED, anchor="middle")

    # Top-right: watcher
    bx2 = half + 16
    _rrect(c, bx2, by, bw, bh, r=7, fill=CARD, stroke=CARD_LINE)
    _text(c, bx2 + 12, by + bh - 15, "Never miss an event", font=F_BODY_B,
          size=9.5, color=BODY)
    _node(c, bx2 + 12, by + 12, (bw - 36) / 2, bh - 40, "Polling",
          "The reliable source of truth.", accent=AMBER_SOFT,
          title_size=8.5, body_size=7.2)
    _node(c, bx2 + 24 + (bw - 36) / 2, by + 12, (bw - 36) / 2, bh - 40,
          "WebSocket", "Optional speed-up when available.", accent=MUTED,
          title_size=8.5, body_size=7.2)
    _text(c, bx2 + bw / 2, by + 5, "De-duplicated, so each job runs once.",
          font=F_BODY, size=7, color=MUTED, anchor="middle")

    # Bottom-left: idempotent agents
    by2 = 0
    _rrect(c, 0, by2, half, row_h, r=7, fill=INK, stroke=INK)
    c.setFillColor(AMBER)
    c.roundRect(0, by2, 4, row_h, 2, stroke=0, fill=1)
    _text(c, 14, by2 + row_h - 15, "Safe to retry", font=F_BODY_B, size=9.5,
          color=AMBER)
    for j, ln in enumerate(_fit(
        c, "Agents check the chain before acting. If a step is already done, "
           "they treat it as success instead of fighting over it — no double "
           "charges, no error storms.", F_BODY, 7.8, half - 24)):
        _text(c, 14, by2 + row_h - 30 - j * 10, ln, font=F_BODY, size=7.8,
              color=CHALK)

    # Bottom-right: cold start
    _rrect(c, half + 16, by2, half, row_h, r=7, fill=CARD, stroke=CARD_LINE)
    _text(c, half + 28, by2 + row_h - 15, "Wakes up cleanly", font=F_BODY_B,
          size=9.5, color=BODY)
    for j, ln in enumerate(_fit(
        c, "On a cold start the runner validates its configuration before it "
           "begins, and the app shows a clear waking state rather than failing "
           "silently while a host spins up.", F_BODY, 7.8, half - 24)):
        _text(c, half + 28, by2 + row_h - 30 - j * 10, ln, font=F_BODY,
              size=7.8, color=MUTED)


# ── Document content ──────────────────────────────────────────────────────────
def cover(st):
    flow = [
        Spacer(1, 0.3 * cm),
        Paragraph("AUTONOMOUS AI TENNIS COACHING", st["CoverKicker"]),
        Spacer(1, 0.5 * cm),
        Paragraph("System Design<br/>&amp; Architecture", st["CoverTitle"]),
        Spacer(1, 0.7 * cm),
        Paragraph(
            "How Velo turns a coaching session into a verifiable,<br/>"
            "athlete-owned training record on the Somnia blockchain.",
            st["CoverSub"]),
        Spacer(1, 1.5 * cm),
        Paragraph("SOMNIA TESTNET · CHAINID 50312", st["CoverMetaK"]),
        Spacer(1, 0.15 * cm),
        Paragraph(date.today().strftime("%B %Y"), st["CoverMetaV"]),
        NextPageTemplate("Body"),
        PageBreak(),
    ]
    return flow


def story(st):
    f: list = []
    f += cover(st)

    # Contents
    f.append(Paragraph("Contents", st["H1"]))
    for line in [
        "1.  What Velo is",
        "2.  System at a glance",
        "3.  The coaching-session trust flow",
        "4.  User journeys",
        "5.  Deployment topology",
        "6.  Resilience &amp; graceful degradation",
        "7.  Why it matters",
    ]:
        f.append(Paragraph(line, st["TOC"]))
    f.append(PageBreak())

    # 1
    f.append(Paragraph("1. What Velo is", st["H1"]))
    f.append(Paragraph(
        "Velo turns a coaching session into a verifiable, athlete-owned "
        "training record. A coach commissions an analysis of an athlete's match "
        "or practice video; a team of specialised AI agents does the work, "
        "signs every result, and settles payment automatically on the Somnia "
        "blockchain. The athlete keeps a permanent, tamper-evident history of "
        "every session that no one — not even the coach or Velo — can quietly "
        "rewrite.", st["Lead"]))
    f.append(Paragraph("The core promise", st["H2"]))
    f += bullets([
        "<b>Verifiable by construction.</b> Every coaching verdict is signed by "
        "the agent that produced it, so authorship can always be checked.",
        "<b>Chained, not just stored.</b> The training plan is provably built "
        "on one specific analysis — steps can't be skipped or swapped.",
        "<b>Athlete-owned.</b> History lives in a soulbound token: append-only, "
        "non-transferable, and held by the athlete.",
        "<b>Autonomous and paid.</b> Agents are discovered, do the work, and "
        "are paid directly — no platform sits in the middle of the money.",
        "<b>Degrades gracefully.</b> Velo prefers verifiable on-chain AI but "
        "always finishes the session, recording which path it used.",
    ], st)

    # 2
    f.append(PageBreak())
    f.append(Paragraph("2. System at a glance", st["H1"]))
    f.append(Paragraph(
        "Velo is built in layers. People interact at the top; value and proof "
        "settle at the bottom. Each layer depends only on the one beneath it, "
        "and the blockchain is the single source of truth for money and "
        "receipts — every off-chain piece is replaceable and never holds "
        "custody of funds.", st["Body"]))
    f.append(Spacer(1, 4))
    f.append(Diagram(330, draw_layers))
    f.append(Paragraph(
        "Figure 1 — The layered architecture. The frontend, agent runner, AI "
        "and vision services all do work off-chain, then write signed results "
        "back to the chain, which holds escrow and the canonical record.",
        st["Caption"]))

    # 3
    f.append(PageBreak())
    f.append(Paragraph("3. The coaching-session trust flow", st["H1"]))
    f.append(Paragraph(
        "A session moves through five stages. At each stage Velo captures a "
        "specific guarantee, so the final result isn't something you have to "
        "take on faith — it's something you can verify. The left column is what "
        "happens; the right column is the trust it earns.", st["Body"]))
    f.append(Spacer(1, 4))
    f.append(Diagram(380, draw_trust_flow))
    f.append(Paragraph(
        "Figure 2 — The session pipeline and the trust guarantee captured at "
        "each step. The plan is cryptographically linked to the exact analysis "
        "it was built on, and agents are paid only when that chain verifies.",
        st["Caption"]))
    f.append(Paragraph("The trust model, in plain terms", st["H2"]))
    f.append(Paragraph(
        "Think of each result as a sealed, signed envelope. The analyst seals "
        "its findings; the plan-writer can only open the job by referencing "
        "that exact sealed envelope, then seals its own on top. The contract "
        "refuses to pay unless the envelopes line up and the signatures match. "
        "Because the final record is soulbound to the athlete, it becomes a "
        "career-long portfolio they control — not data locked inside a coach's "
        "app.", st["Body"]))

    # 4
    f.append(PageBreak())
    f.append(Paragraph("4. User journeys", st["H1"]))
    f.append(Paragraph(
        "Two people use Velo, and each has a short, guided path. Coaches "
        "commission and review work; athletes manage who they work with and "
        "own the results.", st["Body"]))
    f.append(Spacer(1, 6))
    f.append(Diagram(150, draw_coach_journey))
    f.append(Paragraph(
        "Figure 3 — The coach's journey, from wallet sign-in to reviewing a "
        "verified coaching plan.", st["Caption"]))
    f.append(Spacer(1, 6))
    f.append(Diagram(150, draw_athlete_journey))
    f.append(Paragraph(
        "Figure 4 — The athlete's journey. The athlete sets up who they work "
        "with and ends up owning a verifiable record of every session.",
        st["Caption"]))

    # 5
    f.append(PageBreak())
    f.append(Paragraph("5. Deployment topology", st["H1"]))
    f.append(Paragraph(
        "Velo draws a hard line between what is replaceable and what is "
        "authoritative. Everything off-chain — the app, the runner, the vision "
        "and AI services, and file storage — can be swapped or re-hosted "
        "without touching the record, because none of it holds custody. The "
        "blockchain holds the escrow, the signed receipts, and the athlete's "
        "history.", st["Body"]))
    f.append(Spacer(1, 4))
    f.append(Diagram(300, draw_topology))
    f.append(Paragraph(
        "Figure 5 — Deployment topology and trust boundary. The browser reads "
        "the chain and signs transactions through the user's wallet; the "
        "always-on runner watches the chain, calls the off-chain services, and "
        "submits signed work back on-chain.", st["Caption"]))

    # 6
    f.append(PageBreak())
    f.append(Paragraph("6. Resilience &amp; graceful degradation", st["H1"]))
    f.append(Paragraph(
        "Real networks are flaky and AI services come and go. Velo is designed "
        "so a session still completes — and stays correct — when parts of the "
        "system are slow, restart, or are briefly unavailable.", st["Body"]))
    f.append(Spacer(1, 4))
    f.append(Diagram(300, draw_resilience))
    f.append(Paragraph(
        "Figure 6 — The four resilience patterns: a preferred-with-fallback AI "
        "path, a poll-plus-accelerate event watcher, retry-safe (idempotent) "
        "agents, and a clean cold-start.", st["Caption"]))

    # 7
    f.append(PageBreak())
    f.append(Paragraph("7. Why it matters", st["H1"]))
    f.append(Paragraph(
        "Coaching advice is usually unverifiable and trapped in someone else's "
        "app. Velo makes the opposite true: the work is attributable, the plan "
        "is provably tied to the analysis behind it, payment is automatic and "
        "fair, and the resulting record belongs to the athlete for good.",
        st["Lead"]))
    f += bullets([
        "<b>For athletes:</b> a portable, tamper-evident training history that "
        "follows them across coaches and seasons.",
        "<b>For coaches:</b> instant, signed analysis and a transparent way to "
        "commission and pay for specialised work.",
        "<b>For the ecosystem:</b> an open market where any qualified agent can "
        "be discovered, do the work, and be paid on results.",
    ], st)
    f.append(Spacer(1, 10))
    f.append(Paragraph(
        "Built on Somnia testnet (chainId 50312). This document describes the "
        "system at the architecture and flow level; it intentionally omits "
        "implementation and contract internals.", st["Caption"]))
    return f


def build(out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    st = build_styles()
    path = os.path.join(out_dir, "Velo_System_Design.pdf")
    doc = make_doc(path, "System Design & Architecture")
    doc.build(story(st))
    return path


def main():
    ap = argparse.ArgumentParser(description="Generate the Velo system-design PDF.")
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)),
                    help="Output directory (default: this script's folder).")
    args = ap.parse_args()
    path = build(args.out)
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
