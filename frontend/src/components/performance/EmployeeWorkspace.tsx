import React, { useState } from 'react';
import { ClipboardCheck, MessageSquareText, StickyNote, Target, Users } from 'lucide-react';
import { NotesList } from './FeedbackNotes';
import { GoalSheet, KpiLibraryItem, PmsRules } from '../../types/pms';
import { GoalSheetView } from './GoalSheetView';
import { CheckinsPanel } from './CheckinsPanel';
import { Feedback360Panel } from './Feedback360Panel';
import { AppraisalPanel } from './AppraisalPanel';

type SubTab = 'goals' | 'checkins' | 'feedback' | 'appraisal' | 'notes';

interface Props {
  sheet: GoalSheet;
  rules: PmsRules;
  library: KpiLibraryItem[];
  isOwner: boolean;
  onSheetChange: (sheet: GoalSheet) => void;
  onBack?: () => void;
}

/** Everything about one employee's cycle: goals, check-ins, 360° and the year-end appraisal. */
export const EmployeeWorkspace: React.FC<Props> = ({ sheet, rules, library, isOwner, onSheetChange, onBack }) => {
  const [tab, setTab] = useState<SubTab>('goals');
  const tabs: [SubTab, string, React.ComponentType<{ className?: string }>][] = [
    ['goals', 'Goals', Target],
    ['checkins', 'Check-ins', MessageSquareText],
    ['feedback', '360° Feedback', Users],
    ['appraisal', 'Year-end Appraisal', ClipboardCheck],
    ['notes', 'Notes', StickyNote],
  ];

  return (
    <div className="space-y-4">
      {onBack && (
        <button type="button" onClick={onBack} className="text-[11px] font-semibold text-[#039583] hover:underline cursor-pointer">
          ← Back to list
        </button>
      )}
      {!isOwner && (
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold text-slate-900">{sheet.employeeName}</h2>
          <span className="text-xs text-slate-500">{[sheet.designation, sheet.department].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === id ? 'bg-white text-[#023b77] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'goals' && <GoalSheetView sheet={sheet} rules={rules} library={library} onChange={onSheetChange} />}
      {tab === 'checkins' && <CheckinsPanel employeeId={sheet.employeeId} />}
      {tab === 'feedback' && <Feedback360Panel employeeId={sheet.employeeId} isOwner={isOwner} />}
      {tab === 'appraisal' && <AppraisalPanel employeeId={sheet.employeeId} />}
      {tab === 'notes' && <NotesList employeeId={isOwner ? undefined : sheet.employeeId} />}
    </div>
  );
};
