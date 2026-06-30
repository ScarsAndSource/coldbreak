import { motion } from 'motion/react';

export type ArchetypeType = 'deadline_dancer' | 'overwhelmed_perfectionist' | 'context_switcher' | 'paralyzed_planner';

export interface ClassDefinition {
  id: ArchetypeType;
  name: string;
  sigil: string;
  stats: {
    ignition: number; // 1-5
    sustained: number; // 1-5
    risk: number; // 1-5
    structure: number; // 1-5
  };
  passive: string;
}

export const CLASSES_LIST: ClassDefinition[] = [
  {
    id: 'deadline_dancer',
    name: 'Sprint Finisher',
    sigil: 'lightning',
    stats: { ignition: 2, sustained: 3, risk: 5, structure: 1 },
    passive: 'Clusters action blocks tightly before the deadline, maximizing peak focus under pressure.'
  },
  {
    id: 'overwhelmed_perfectionist',
    name: 'Precision Planner',
    sigil: 'concentric',
    stats: { ignition: 3, sustained: 5, risk: 1, structure: 5 },
    passive: 'Decomposes goals into exhaustive, zero-ambiguity micro-steps to remove decision paralysis.'
  },
  {
    id: 'context_switcher',
    name: 'Paced Worker',
    sigil: 'orbit',
    stats: { ignition: 5, sustained: 2, risk: 3, structure: 3 },
    passive: 'Locks work into strict 25-minute focus bursts to fight attention drift.'
  },
  {
    id: 'paralyzed_planner',
    name: 'Step-by-Step Focus Builder',
    sigil: 'lock',
    stats: { ignition: 1, sustained: 3, risk: 1, structure: 5 },
    passive: 'Reveals only the current step, hiding all future steps to prevent overwhelm.'
  }
];

export function SigilIcon({ type, className = "w-6 h-6" }: { type: string; className?: string }) {
  if (type === 'lightning') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    );
  }
  if (type === 'concentric') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }
  if (type === 'orbit') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    );
  }
  // Lock icon
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 11V15M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

interface ClassCardProps {
  classDef: ClassDefinition;
  isSelected: boolean;
  onSelect: () => any;
}

export function ClassCard({ classDef, isSelected, onSelect }: ClassCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`relative p-5 rounded-lg border text-left transition-all duration-300 cursor-pointer flex flex-col justify-between ${
        isSelected
          ? 'bg-live-accent/5 border-live-accent shadow-[0_0_15px_rgba(0,245,212,0.15)]'
          : 'bg-[#040814]/40 border-[#27272a]/60 hover:border-[#27272a] hover:bg-[#060c20]/40'
      }`}
    >
      {/* Corner indicator */}
      {isSelected && (
        <div className="absolute top-0 right-0 w-3 h-3 bg-live-accent rounded-tr-md rounded-bl-md" />
      )}

      <div>
        {/* Header (Sigil + Name) */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded border ${
            isSelected ? 'border-live-accent/40 bg-live-accent/10 text-live-accent' : 'border-[#27272a] text-[#a1a1aa]'
          }`}>
            <SigilIcon type={classDef.sigil} className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono tracking-widest text-[#52525b] block">CLASS</span>
            <span className="text-sm font-sans font-medium text-white">{classDef.name}</span>
          </div>
        </div>

        {/* 4-Bar Stats Readout */}
        <div className="space-y-2.5 mb-5">
          <div className="grid grid-cols-5 items-center gap-2 text-[10px] font-mono text-[#a1a1aa]">
            <span className="col-span-2 text-left tracking-wider text-[8.5px]">IGNITION</span>
            <div className="col-span-3 flex gap-1">
              {[1, 2, 3, 4, 5].map(tick => (
                <div
                  key={tick}
                  className={`h-1.5 flex-1 rounded-sm ${
                    tick <= classDef.stats.ignition
                      ? isSelected ? 'bg-live-accent' : 'bg-white/70'
                      : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 items-center gap-2 text-[10px] font-mono text-[#a1a1aa]">
            <span className="col-span-2 text-left tracking-wider text-[8.5px]">SUSTAINED</span>
            <div className="col-span-3 flex gap-1">
              {[1, 2, 3, 4, 5].map(tick => (
                <div
                  key={tick}
                  className={`h-1.5 flex-1 rounded-sm ${
                    tick <= classDef.stats.sustained
                      ? isSelected ? 'bg-live-accent' : 'bg-white/70'
                      : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 items-center gap-2 text-[10px] font-mono text-[#a1a1aa]">
            <span className="col-span-2 text-left tracking-wider text-[8.5px]">RISK TOL</span>
            <div className="col-span-3 flex gap-1">
              {[1, 2, 3, 4, 5].map(tick => (
                <div
                  key={tick}
                  className={`h-1.5 flex-1 rounded-sm ${
                    tick <= classDef.stats.risk
                      ? isSelected ? 'bg-live-accent' : 'bg-white/70'
                      : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 items-center gap-2 text-[10px] font-mono text-[#a1a1aa]">
            <span className="col-span-2 text-left tracking-wider text-[8.5px]">STRUCTURE</span>
            <div className="col-span-3 flex gap-1">
              {[1, 2, 3, 4, 5].map(tick => (
                <div
                  key={tick}
                  className={`h-1.5 flex-1 rounded-sm ${
                    tick <= classDef.stats.structure
                      ? isSelected ? 'bg-live-accent' : 'bg-white/70'
                      : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Passive Ability block */}
      <div className="pt-3 border-t border-white/5">
        <span className="text-[8px] font-mono tracking-widest text-[#52525b] uppercase block mb-1">PASSIVE PROTOCOL</span>
        <p className="text-[11px] text-[#a1a1aa] leading-normal font-sans italic">
          "{classDef.passive}"
        </p>
      </div>
    </div>
  );
}
