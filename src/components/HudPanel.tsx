import { motion } from 'motion/react';
import { Snowflake, Gem, Activity, Link as LinkIcon, ShieldAlert } from 'lucide-react';

interface HudPanelProps {
  completionCount: number;
  totalXP: number; // Real XP from Firestore — used directly
  coldStreak?: number;
  frostShards?: number;
  totalBreaches?: number;
  cryoSavesRemaining?: number;
}

export function HudPanel({
  completionCount,
  totalXP,
  coldStreak = 5,
  frostShards = 128,
  totalBreaches = 2,
  cryoSavesRemaining = 5
}: HudPanelProps) {
  
  // Calculate Rank name and rank insignia
  let rankName = 'Frost Recruit';
  let rankIcon = '▽';
  
  if (completionCount >= 10) {
    rankName = 'Absolute Zero Commander';
    rankIcon = '❄';
  } else if (completionCount >= 6) {
    rankName = 'Breach Commander';
    rankIcon = '🜲';
  } else if (completionCount >= 4) {
    rankName = 'Cryo Specialist';
    rankIcon = '✵';
  } else if (completionCount >= 2) {
    rankName = 'Containment Operative';
    rankIcon = '⬡';
  } else if (completionCount >= 1) {
    rankName = 'Frost Cadet';
    rankIcon = '◇';
  } else if (completionCount === 0) {
    rankName = 'Frost Cadet';
    rankIcon = '◇';
  }

  // Use real XP from props — no fabricated base values
  // Dynamic max: next 500 XP milestone above current
  const maxXP = Math.max(500, Math.ceil((totalXP + 1) / 500) * 500);
  const xpPercent = Math.min(100, Math.round((totalXP / maxXP) * 100));

  return (
    <div id="operative-profile-hud" className="w-full cryo-glass px-5 py-3 rounded-lg flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 select-none font-mono text-[11px] tracking-wider uppercase">
      
      {/* LEFT: Rank Insignia + Name */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-md border border-live-accent/25 bg-live-accent/5 flex items-center justify-center text-lg text-live-accent font-mono shadow-[0_0_10px_rgba(0,245,212,0.1)]">
          {rankIcon}
        </div>
        <div className="text-left">
          <span className="text-[8px] text-[#52525b] block tracking-widest">COGNITIVE PROGRESSION</span>
          <span className="text-xs font-semibold text-white tracking-wide">{rankName}</span>
        </div>
      </div>

      {/* MIDDLE: Horizontal XP bar with numeric label */}
      <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-0 lg:px-6">
        <div className="text-[#a1a1aa] whitespace-nowrap text-[10px] self-start sm:self-center font-mono">
          XP: <span className="text-white font-bold">{totalXP.toLocaleString()}</span> / {maxXP.toLocaleString()}
        </div>
        <div className="flex-1 bg-white/5 h-2 rounded-sm relative overflow-hidden self-center border border-white/5 w-full">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${xpPercent}%` }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="bg-gradient-to-r from-live-accent/50 to-live-accent h-full rounded-sm relative"
          >
            {/* Holographic scanner pulse across XP bar */}
            <motion.div
              animate={{ x: ['-100%', '300%'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
              className="absolute top-0 bottom-0 left-0 w-1/4 bg-white/30 skew-x-12 blur-[1px]"
            />
          </motion.div>
        </div>
        <div className="text-[#52525b] text-[8px] whitespace-nowrap text-right self-end sm:self-center">
          {xpPercent}% COMPLETE
        </div>
      </div>

      {/* RIGHT: Three small understated stat chips */}
      <div className="flex flex-wrap items-center gap-3 shrink-0 justify-start lg:justify-end">
        {/* Stat Chip 1: Frost-link Chain icon */}
        <div className="flex items-center gap-2 bg-[#040814]/80 border border-white/5 px-3 py-1.5 rounded text-zinc-300">
          <LinkIcon className="w-3.5 h-3.5 text-live-accent" />
          <span>Cold Streak: <span className="text-white font-bold">{coldStreak}</span></span>
        </div>

        {/* Stat Chip 2: Crystal shard icon */}
        <div className="flex items-center gap-2 bg-[#040814]/80 border border-white/5 px-3 py-1.5 rounded text-zinc-300">
          <Gem className="w-3.5 h-3.5 text-live-accent" />
          <span>Frost Shards: <span className="text-white font-bold">{frostShards}</span></span>
        </div>

        {/* Stat Chip 3: Plain stat Total Breaches */}
        <div className="flex items-center gap-2 bg-[#040814]/80 border border-white/5 px-3 py-1.5 rounded text-zinc-300">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-500/80" />
          <span>Total Breaches: <span className="text-white font-bold">{totalBreaches}</span></span>
        </div>

        {/* Stat Chip 4: Cryo Saves Remaining */}
        <div className="flex items-center gap-2 bg-[#040814]/80 border border-white/5 px-3 py-1.5 rounded text-zinc-300">
          <Snowflake className="w-3.5 h-3.5 text-sky-400" />
          <span>Cryo-Saves: <span className="text-white font-bold">{cryoSavesRemaining}</span></span>
        </div>
      </div>

    </div>
  );
}
