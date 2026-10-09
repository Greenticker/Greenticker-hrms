import React, { useState, useEffect } from 'react';
import { modulesService } from '../services/modulesService';
import { FullFinalSettlement } from '../types/modules';
import { UserMinus, CheckCircle2, AlertCircle, FileCheck, Building, CreditCard, Laptop, ShieldCheck } from 'lucide-react';

export const FullFinalPage: React.FC = () => {
  const [settlements, setSettlements] = useState<FullFinalSettlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFnF = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getFullFinalSettlements();
        setSettlements(res.settlements);
      } catch (err) {
        console.error('Failed to load FnF records', err);
      } finally {
        setLoading(false);
      }
    };
    fetchFnF();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Full and Final Settlement
        </h1>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading settlement dossiers...</div>
      ) : settlements.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          No pending or active separation settlements.
        </div>
      ) : (
        settlements.map((fnf) => (
          <div key={fnf._id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
              <div>
                <span className="text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  F&F DOSSIER • {fnf.employeeCode}
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  Separation Statement: {fnf.employeeName}
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  {fnf.department} • Resigned: {fnf.resignationDate} • Last Working Day: {fnf.lastWorkingDay}
                </p>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 font-bold text-xs uppercase flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {fnf.status.replace('_', ' ')}
              </div>
            </div>

            {/* Clearances Checklist Matrix */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Departmental Clearance Matrix
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-800">Department</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-[11px] text-slate-500">{fnf.clearances.department.remarks}</p>
                  <p className="text-[10px] text-slate-400 font-mono">Cleared by {fnf.clearances.department.clearedBy}</p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-800">IT Hardware</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-[11px] text-slate-500">{fnf.clearances.itAssets.remarks}</p>
                  <p className="text-[10px] text-slate-400 font-mono">Cleared by {fnf.clearances.itAssets.clearedBy}</p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-800">Finance & Cards</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-[11px] text-slate-500">{fnf.clearances.finance.remarks}</p>
                  <p className="text-[10px] text-slate-400 font-mono">Cleared by {fnf.clearances.finance.clearedBy}</p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-800">Admin & Badges</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-[11px] text-slate-500">{fnf.clearances.admin.remarks}</p>
                  <p className="text-[10px] text-slate-400 font-mono">Cleared by {fnf.clearances.admin.clearedBy}</p>
                </div>
              </div>
            </div>

            {/* Financial Settlement Breakdown */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Settlement Computation Summary
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Unpaid Days Salary</span>
                  <p className="text-sm font-bold text-slate-900">₹{fnf.settlementComponents.unpaidSalary.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Leave Encashment ({fnf.settlementComponents.leaveEncashmentDays} Days)</span>
                  <p className="text-sm font-bold text-slate-900">₹{fnf.settlementComponents.leaveEncashmentAmount.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Gratuity Payout</span>
                  <p className="text-sm font-bold text-slate-900">₹{fnf.settlementComponents.gratuity.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Pro-rated Bonus</span>
                  <p className="text-sm font-bold text-slate-900">₹{fnf.settlementComponents.bonusOrIncentive.toLocaleString()}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-900">Total Net Settlement Disbursed</span>
                <span className="text-xl font-black text-emerald-600 font-mono">
                  ₹{fnf.settlementComponents.totalPayable.toLocaleString()} INR
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
