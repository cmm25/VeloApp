import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { useAppKit } from "@reown/appkit/react";
import landingCollage from "../assets/landing-collage.png";
import { motion } from "framer-motion";
import { Wallet } from "lucide-react";

export default function Landing() {
  const { isConnected } = useAccount();
  const [, setLocation] = useLocation();
  const { open } = useAppKit();
  const collageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isConnected) setLocation("/choose-role");
  }, [isConnected, setLocation]);

  // Subtle mouse-parallax on the right collage. Disabled on touch / no pointer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (!collageRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dx = (e.clientX / w - 0.5) * 18;
        const dy = (e.clientY / h - 0.5) * 18;
        collageRef.current!.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-background overflow-hidden relative">
      {/* LEFT — editorial column: wordmark · headline · connect */}
      <div className="flex-1 flex flex-col p-8 md:p-12 lg:p-16 z-10 min-w-0">
        {/* Wordmark top-left */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-baseline gap-1"
        >
          <span className="font-serif-display text-2xl md:text-3xl tracking-tight text-chalk">
            Velo
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
        </motion.div>

        {/* Headline + CTA, vertically centered in the remaining space */}
        <div className="flex-1 flex items-center">
          <motion.div
            className="max-w-xl space-y-10"
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.15, delayChildren: 0.15 } },
            }}
          >
            <motion.h1
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
              className="font-serif-display text-5xl md:text-6xl lg:text-7xl leading-[0.95] text-chalk tracking-tight"
            >
              A verifiable training record, owned by the <span className="text-amber">athlete</span>.
            </motion.h1>

            <motion.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
            >
              <button
                onClick={() => open()}
                className="group inline-flex items-center gap-3 bg-chalk hover:bg-chalk/90 text-ink pl-5 pr-3 py-3 rounded-full text-sm font-bold tracking-wide transition-all"
              >
                <Wallet className="w-4 h-4" />
                Connect wallet
                <span className="ml-2 inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber text-ink transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* RIGHT — bespoke collage with parallax */}
      <div className="flex-1 relative min-h-[40vh] md:min-h-screen overflow-hidden">
        <motion.div
          ref={collageRef}
          className="absolute -inset-4 bg-cover bg-center bg-no-repeat will-change-transform"
          style={{
            backgroundImage: `url(${landingCollage})`,
            filter: "grayscale(100%) contrast(1.15)",
            transition: "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 0.7, scale: 1.04 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/20 to-transparent md:bg-gradient-to-r" />
        <div className="absolute inset-0 bg-amber/5 mix-blend-overlay" />
      </div>
    </div>
  );
}
