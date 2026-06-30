import { motion } from 'motion/react';

interface ContainmentIntegrityCoreProps {
  score: number;
}

export function ContainmentIntegrityCore({ score }: ContainmentIntegrityCoreProps) {
  const isCold = score >= 70;
  const isWarm = score >= 40 && score < 70;
  const isHot = score < 40;

  return (
    <div className="relative w-44 h-44 flex items-center justify-center select-none mx-auto">
      {/* Outer spinning dash ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 border border-dashed border-white/5 rounded-full"
      />

      {/* Main Frosted Crystal Sphere */}
      <div className="absolute inset-2 rounded-full cryo-glass flex items-center justify-center overflow-hidden">
        {/* Deep orb atmosphere shading */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/80 via-transparent to-white/5 z-0" />
        
        {/* Central glowing plasma light (drifting inside) */}
        <motion.div
          animate={{
            scale: [0.9, 1.1, 0.9],
            x: [-6, 6, -6],
            y: [-4, 4, -4],
          }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-4 rounded-full bg-radial from-live-accent/20 via-transparent to-transparent blur-md z-10"
        />

        {/* Ambient particulate layers */}
        <div className="absolute inset-2 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/10 via-transparent to-black/40 z-10 rounded-full" />

        {/* Fine fracture lines overlay if WARM */}
        {isWarm && (
          <svg className="absolute inset-6 w-32 h-32 text-amber-500 opacity-65 z-20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M50,15 L53,32 L46,47 L52,62 L49,85" strokeLinecap="round" />
            <path d="M46,47 L32,42 L18,50" strokeLinecap="round" />
            <path d="M52,62 L68,66 L82,58" strokeLinecap="round" />
            <path d="M53,32 L68,27 L75,38" strokeLinecap="round" />
          </svg>
        )}
        
        {/* Visibly cracked lines glowing red if HOT */}
        {isHot && (
          <motion.svg 
            animate={{ opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-6 w-32 h-32 text-rose-500 z-20" 
            viewBox="0 0 100 100" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1.8"
          >
            <path d="M50,8 L54,28 L42,43 L54,68 L44,92" strokeLinecap="round" />
            <path d="M42,43 L22,38 L8,48" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M54,68 L78,72 L92,62" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M54,28 L74,23 L84,36" strokeLinecap="round" />
            <path d="M42,43 L37,63 L18,72" strokeLinecap="round" />
          </motion.svg>
        )}

        {/* Top glossy refraction curvature */}
        <div className="absolute top-1 left-4 right-4 h-12 bg-gradient-to-b from-white/12 to-transparent rounded-full blur-[1px] z-30" />
        
        {/* Centered Readout Value */}
        <div className="relative z-30 text-center">
          <span className="text-3xl font-mono font-bold tracking-tighter text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            {score}%
          </span>
          <div className="text-[7.5px] font-mono tracking-[0.2em] text-[#A1A1AA] uppercase mt-1">
            CONTAINMENT
          </div>
        </div>
      </div>
    </div>
  );
}
