import { motion } from 'motion/react';

interface SentinelDroneProps {
  pulsing?: boolean;
}

export function SentinelDrone({ pulsing = true }: SentinelDroneProps) {
  return (
    <div className="relative flex items-center justify-center w-24 h-24 mx-auto">
      {/* Hexagonal Outer ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 flex items-center justify-center text-live-accent opacity-30"
      >
        <svg className="w-full h-full" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="50,5 90,25 90,75 50,95 10,75 10,25" />
        </svg>
      </motion.div>

      {/* Hexagonal Inner ring */}
      <motion.div
        animate={{ scale: [0.95, 1.05, 0.95], rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-2 flex items-center justify-center text-live-accent opacity-15"
      >
        <svg className="w-full h-full" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1">
          <polygon points="50,15 80,30 80,70 50,85 20,70 20,30" />
        </svg>
      </motion.div>

      {/* Pulsating focal point/light of SENTINEL */}
      <motion.div
        animate={pulsing ? { 
          scale: [1, 1.25, 1], 
          opacity: [0.7, 1, 0.7],
          boxShadow: [
            "0 0 12px var(--live-accent)",
            "0 0 24px var(--live-accent)",
            "0 0 12px var(--live-accent)"
          ]
        } : {}}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        className="w-4 h-4 rounded-full bg-live-accent flex items-center justify-center z-10"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-white opacity-90" />
      </motion.div>
    </div>
  );
}
