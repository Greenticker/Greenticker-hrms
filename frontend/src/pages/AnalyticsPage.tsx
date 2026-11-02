import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types/auth';
import {
  TrendingUp,
  Users,
  Building2,
  Calendar,
  Clock,
  PieChart,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Award,
  Filter,
} from 'lucide-react';

export const AnalyticsPage: React.FC = () => {
  const { user } = useAuth();
  const [timeframe, setTimeframe] = useState<'YTD' | 'Q3_2026' | 'LAST_12_MO'>('YTD');
  const [deptFilter, setDeptFilter] = useState('ALL');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#023b77] text-white p-6 rounded-2xl border border-[#039583]/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <PieChart className="w-6 h-6 text-[#039583]" />
            <span>Executive Workforce Analytics & Insights</span>
          </h1>
          <p className="text-xs text-slate-200 mt-1">
            Real-time HR intelligence, headcount trends, salary distribution, attrition risk & diversity metrics.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="bg-white/10 backdrop-blur-md p-1 rounded-xl border border-white/20 flex items-center gap-1 text-xs font-semibold">
            <button
              onClick={() => setTimeframe('YTD')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                timeframe === 'YTD' ? 'bg-white text-slate-900 font-bold' : 'text-white hover:bg-white/10'
              }`}
            >
              YTD 2026
            </button>
            <button
              onClick={() => setTimeframe('Q3_2026')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                timeframe === 'Q3_2026' ? 'bg-white text-slate-900 font-bold' : 'text-white hover:bg-white/10'
              }`}
            >
              Q3 2026
            </button>
            <button
              onClick={() => setTimeframe('LAST_12_MO')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                timeframe === 'LAST_12_MO' ? 'bg-white text-slate-900 font-bold' : 'text-white hover:bg-white/10'
              }`}
            >
              Last 12 Months
            </button>
          </div>
        </div>
      </div>

      {/* Executive Key Performance Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Active Headcount</span>
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">148</span>
            <span className="text-xs font-bold text-emerald-600 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +12% YoY
            </span>
          </div>
          <p className="text-[11px] text-slate-500">142 Permanent · 6 Probation</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Annual Attrition Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-600 font-mono">4.2%</span>
            <span className="text-xs font-bold text-emerald-600 flex items-center">
              <ArrowDownRight className="w-3.5 h-3.5" /> -1.8% vs Benchmark
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Industry Avg: 11.5% in Tech</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Avg Employee Tenure</span>
            <Clock className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">3.4</span>
            <span className="text-xs font-semibold text-slate-500">Years</span>
          </div>
          <p className="text-[11px] text-slate-500">High retention in Core Engineering</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Attendance Adherence</span>
            <ShieldCheck className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-blue-600 font-mono">96.8%</span>
            <span className="text-xs font-bold text-emerald-600 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +2.4%
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Hybrid 2-day in-office model</p>
        </div>
      </div>

      {/* Main Analytics Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Headcount & Salary CTC Distribution */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Department Headcount & CTC Share
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Distribution across key organizational business units</p>
            </div>
            <span className="text-xs font-mono text-slate-400 font-bold">148 Personnel</span>
          </div>

          <div className="space-y-4 pt-2">
            {[
              { dept: 'Engineering & Technology', count: 62, pct: 42, salaryShare: '48%', color: 'bg-indigo-600' },
              { dept: 'Product & UX Design', count: 24, pct: 16, salaryShare: '18%', color: 'bg-purple-600' },
              { dept: 'Sales & Customer Success', count: 32, pct: 22, salaryShare: '19%', color: 'bg-blue-600' },
              { dept: 'Finance & Compliance', count: 16, pct: 11, salaryShare: '9%', color: 'bg-emerald-600' },
              { dept: 'People Operations & HR', count: 14, pct: 9, salaryShare: '6%', color: 'bg-amber-600' },
            ].map((d) => (
              <div key={d.dept} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800">{d.dept}</span>
                  <div className="flex items-center gap-3 font-mono text-slate-600">
                    <span>{d.count} staff ({d.pct}%)</span>
                    <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">CTC Share: {d.salaryShare}</span>
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${d.color} transition-all duration-500`} style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Leave & Quota Utilization Index */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Leave Quota & Burnup Analysis
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Year-to-date leave consumption trends</p>
            </div>
            <span className="text-xs font-mono text-slate-400 font-bold">YTD 2026</span>
          </div>

          <div className="space-y-4 pt-2">
            {[
              { label: 'Casual Leave (CL)', utilized: '34%', total: '12 days / emp', status: 'Healthy', color: 'bg-blue-500' },
              { label: 'Earned Leave (EL)', utilized: '48%', total: '18 days / emp', status: 'Optimal', color: 'bg-amber-500' },
              { label: 'Sick Leave (SL)', utilized: '22%', total: '10 days / emp', status: 'Low risk', color: 'bg-rose-500' },
              { label: 'Remote Work (WFH)', utilized: '82%', total: 'Hybrid quota', status: 'High demand', color: 'bg-emerald-500' },
              { label: 'Maternity / Parental', utilized: '12%', total: 'Statutory quota', status: 'Normal', color: 'bg-purple-500' },
            ].map((l) => (
              <div key={l.label} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800">{l.label}</span>
                  <div className="flex items-center gap-2 font-mono text-slate-600">
                    <span>{l.utilized} consumed</span>
                    <span className="text-[10px] font-sans font-semibold text-slate-400">({l.total})</span>
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${l.color} transition-all duration-500`} style={{ width: l.utilized }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Analytics: Diversity & Employment Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Employment Status Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Workforce Tenure & Status
          </h3>
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-950 block">Permanent Employees</span>
                <span className="text-[11px] text-emerald-700">Confirmed headcount</span>
              </div>
              <span className="text-xl font-black text-emerald-900 font-mono">142</span>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-amber-950 block">Probation Period</span>
                <span className="text-[11px] text-amber-700">Under 6-month evaluation</span>
              </div>
              <span className="text-xl font-black text-amber-900 font-mono">6</span>
            </div>

            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-indigo-950 block">Temporary / Contract</span>
                <span className="text-[11px] text-indigo-700">Fixed-term specialists</span>
              </div>
              <span className="text-xl font-black text-indigo-900 font-mono">8</span>
            </div>
          </div>
        </div>

        {/* Job Type Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Job Type Distribution
          </h3>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-800">Full Time</span>
              <span className="text-sm font-mono font-bold text-slate-900">128 (86%)</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-800">Internship / Trainee</span>
              <span className="text-sm font-mono font-bold text-purple-700">12 (8%)</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-800">Contract</span>
              <span className="text-sm font-mono font-bold text-amber-700">5 (3%)</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-800">Part Time</span>
              <span className="text-sm font-mono font-bold text-blue-700">3 (2%)</span>
            </div>
          </div>
        </div>

        {/* Diversity & Gender Ratio */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Diversity & Gender Ratio
          </h3>
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="font-bold text-slate-800">Gender Inclusion Ratio</span>
                <span className="font-mono text-slate-600">42% Female Representation</span>
              </div>
              <div className="w-full h-3 rounded-full bg-blue-500 overflow-hidden flex">
                <div className="h-full bg-purple-500" style={{ width: '42%' }} title="Female: 42%" />
                <div className="h-full bg-blue-500" style={{ width: '56%' }} title="Male: 56%" />
                <div className="h-full bg-amber-500" style={{ width: '2%' }} title="Non-binary / Undisclosed: 2%" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 font-mono">
                <span className="text-purple-700 font-bold">42% Female (62)</span>
                <span className="text-blue-700 font-bold">56% Male (83)</span>
                <span className="text-amber-700 font-bold">2% Other (3)</span>
              </div>
            </div>

            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-purple-950 block">Leadership Diversity</span>
                <span className="text-[11px] text-purple-700">Female managers & team leads</span>
              </div>
              <span className="text-lg font-black text-purple-900 font-mono">38%</span>
            </div>
          </div>
        </div>
      </div>

      {/* AI HR Insights & Recommendations */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-6 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center gap-2 text-indigo-400">
          <Sparkles className="w-5 h-5" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">AI HR Intelligence Insights</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-200 pt-1">
          <div className="p-3.5 bg-white/10 rounded-xl border border-white/10 space-y-1">
            <span className="font-bold text-white block">Optimal Retention in Engineering</span>
            <p className="text-slate-300">Engineering tenure averages 4.1 years. Low attrition risk detected across tech staff.</p>
          </div>
          <div className="p-3.5 bg-white/10 rounded-xl border border-white/10 space-y-1">
            <span className="font-bold text-white block">Probation Evaluation Alert</span>
            <p className="text-slate-300">6 employees reach 6-month probation milestone within 30 days. Review confirmation alerts.</p>
          </div>
          <div className="p-3.5 bg-white/10 rounded-xl border border-white/10 space-y-1">
            <span className="font-bold text-white block">Hybrid Attendance Health</span>
            <p className="text-slate-300">Hybrid in-office compliance is 96.8%. Leave requests peak around festival holidays.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
