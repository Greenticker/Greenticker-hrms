import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { modulesService } from '../services/modulesService';
import { request } from '../services/api';
import { computeSalaryStructure } from '../services/salaryStructure';
import { TaxDeclaration, Form24QData } from '../types/modules';
import {
  FileCheck,
  Shield,
  Download,
  Calculator,
  Save,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  TrendingDown,
  Building,
  CreditCard,
  Printer,
  Sparkles,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Tax rules (FY 2026-27)
// ---------------------------------------------------------------------------
// New regime: no standard deduction is applied. The ONLY deduction kept is
// employer NPS u/s 80CCD(2) = 14% of Basic.
const STANDARD_DEDUCTION_OLD = 50000;
const NPS_PERCENT_OF_BASIC = 0.14;
const CESS_RATE = 0.04;

type Slab = { upTo: number; rate: number };

const NEW_REGIME_SLABS: Slab[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.1 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.2 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: Infinity, rate: 0.3 },
];

const OLD_REGIME_SLABS: Slab[] = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.2 },
  { upTo: Infinity, rate: 0.3 },
];

interface TaxBreakdown {
  slabTax: number;
  rebate: number;
  cess: number;
  total: number;
}

function applySlabs(income: number, slabs: Slab[]): number {
  let tax = 0;
  let prev = 0;
  for (const s of slabs) {
    if (income > prev) tax += (Math.min(income, s.upTo) - prev) * s.rate;
    prev = s.upTo;
  }
  return tax;
}

/** Income tax on a taxable income, incl. Sec 87A rebate and 4% cess (surcharge not modelled). */
function computeTax(taxableIncome: number, regime: 'NEW' | 'OLD'): TaxBreakdown {
  const income = Math.max(0, taxableIncome);
  const slabTax = applySlabs(income, regime === 'NEW' ? NEW_REGIME_SLABS : OLD_REGIME_SLABS);

  let rebate = 0;
  if (regime === 'NEW') {
    // Rebate: nil tax up to Rs. 12,00,000 taxable income (max Rs. 60,000), with marginal relief just above it
    if (income <= 1200000) rebate = Math.min(slabTax, 60000);
    else rebate = Math.max(0, slabTax - (income - 1200000));
  } else if (income <= 500000) {
    rebate = Math.min(slabTax, 12500);
  }

  const taxAfterRebate = Math.max(0, slabTax - rebate);
  const cess = taxAfterRebate * CESS_RATE;
  return {
    slabTax: Math.round(slabTax),
    rebate: Math.round(rebate),
    cess: Math.round(cess),
    total: Math.round(taxAfterRebate + cess),
  };
}

const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const TaxPage: React.FC = () => {
  const { user } = useAuth();
  const [declaration, setDeclaration] = useState<TaxDeclaration | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'declaration' | 'form16' | 'form27a' | 'comparator'>('declaration');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form state
  const [regime, setRegime] = useState<'NEW' | 'OLD'>('NEW');
  const [sec80C, setSec80C] = useState({
    epf: 9360,
    ppf: 50000,
    elss: 40000,
    lifeInsurance: 25000,
    taxSaverFD: 25640,
  });
  const [sec80D, setSec80D] = useState({
    selfSpouseChildren: 25000,
    parents: 50000,
  });
  const [hra, setHra] = useState({
    annualRentPaid: 36000,
    landlordPan: 'LLPAN9821X',
    landlordName: 'Robert Vance Realty LLC',
    cityType: 'METRO' as 'METRO' | 'NON_METRO',
  });
  const [nps, setNps] = useState(50000);
  const [homeLoan, setHomeLoan] = useState(0);
  const [annualCtc, setAnnualCtc] = useState(0);
  const [form24QData, setForm24QData] = useState<Form24QData | null>(null);
  const [form16EmpIndex, setForm16EmpIndex] = useState(0);
  const [validationResult, setValidationResult] = useState<any>(null);

  useEffect(() => {
    modulesService.getForm24QData().then(res => {
      if (res.success && res.data) setForm24QData(res.data);
    }).catch(err => console.error('Failed to load Form 24Q', err));
  }, []);

  useEffect(() => {
    if (form24QData?.employees && user && user.role !== 'ADMIN') {
      const matchedIdx = form24QData.employees.findIndex(emp => 
        emp.name.toLowerCase().includes((user.firstName || '').toLowerCase()) ||
        emp.name.toLowerCase().includes((user.lastName || '').toLowerCase())
      );
      if (matchedIdx !== -1) {
        setForm16EmpIndex(matchedIdx);
      }
    }
  }, [form24QData, user]);

  const handleUpdateStatus = async (status: 'Draft' | 'Filed' | 'Acknowledged', ackNo?: string) => {
    try {
      const res = await modulesService.updateForm24QStatus(status, ackNo);
      if (res.success) {
        setForm24QData(res.form24q);
        setFeedback(`TDS Filing status updated to ${status}`);
      }
    } catch (err: any) {
      setFeedback(`Failed to update status: ${err.message}`);
    }
  };

  const handleValidateTDS = async () => {
    try {
      const res = await modulesService.validateForm24Q();
      if (res.success) {
        setValidationResult(res.validation);
      }
    } catch (err: any) {
      setFeedback(`Validation failed: ${err.message}`);
    }
  };

  // Annual CTC -> Basic salary (used for the 14% employer NPS in the new regime)
  useEffect(() => {
    const fetchCtc = async () => {
      try {
        const res = await request<{ annualCtc: number }>('/payroll/salary-structure');
        setAnnualCtc(Number(res.annualCtc) || 0);
      } catch (err) {
        console.error('Failed to load salary structure', err);
      }
    };
    fetchCtc();
  }, []);

  useEffect(() => {
    const fetchTax = async () => {
      setLoading(true);
      try {
        const res = await modulesService.getTaxDeclaration();
        if (res.declaration) {
          setDeclaration(res.declaration);
          setRegime(res.declaration.regime);
          setSec80C(res.declaration.section80C);
          setSec80D(res.declaration.section80D);
          setHra({
            annualRentPaid: res.declaration.hraExemption.annualRentPaid,
            landlordPan: res.declaration.hraExemption.landlordPan || '',
            landlordName: res.declaration.hraExemption.landlordName || '',
            cityType: res.declaration.hraExemption.cityType,
          });
          setNps(res.declaration.section80CCD_1B || 0);
          setHomeLoan(res.declaration.homeLoanInterest80EE || 0);
        }
      } catch (err) {
        console.error('Failed to load tax declaration', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTax();
  }, []);

  const total80C = Math.min(
    15000,
    (Number(sec80C.epf) || 0) +
      (Number(sec80C.ppf) || 0) +
      (Number(sec80C.elss) || 0) +
      (Number(sec80C.lifeInsurance) || 0) +
      (Number(sec80C.taxSaverFD) || 0)
  );

  const total80D = (Number(sec80D.selfSpouseChildren) || 0) + (Number(sec80D.parents) || 0);
  const hraCalculated = Math.round((Number(hra.annualRentPaid) || 0) * 0.85);

  // ---- NEW REGIME: only employer NPS (14% of Basic) is deductible ----
  const basicYearly = useMemo(
    () => computeSalaryStructure(annualCtc).wages.find((w) => w.key === 'basic')?.yearly ?? 0,
    [annualCtc]
  );
  const npsEmployer = Math.round(basicYearly * NPS_PERCENT_OF_BASIC);
  const newTaxable = Math.max(0, annualCtc - npsEmployer);
  const newTax = computeTax(newTaxable, 'NEW');

  // ---- OLD REGIME: existing declarations ----
  const oldDeductionsTotal =
    total80C + total80D + hraCalculated + (Number(nps) || 0) + (Number(homeLoan) || 0);
  const oldTaxable = Math.max(0, annualCtc - STANDARD_DEDUCTION_OLD - oldDeductionsTotal);
  const oldTax = computeTax(oldTaxable, 'OLD');

  const totalDeductions =
    regime === 'NEW'
      ? npsEmployer
      : total80C + total80D + (Number(nps) || 0) + (Number(homeLoan) || 0);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const isNew = regime === 'NEW';
      const res = await modulesService.saveTaxDeclaration({
        financialYear: '2026-2027',
        regime,
        // New regime: 80C / 80D / HRA / 80CCD(1B) / home loan are not applicable -> zeroed.
        // The employer NPS (14% of Basic) is stored in totalDeductionsDeclared.
        section80C: isNew
          ? { epf: 0, ppf: 0, elss: 0, lifeInsurance: 0, taxSaverFD: 0, total: 0, maxLimit: 150000 }
          : {
              ...sec80C,
              total: total80C,
              maxLimit: 150000,
            },
        section80D: isNew
          ? { selfSpouseChildren: 0, parents: 0, total: 0 }
          : {
              ...sec80D,
              total: total80D,
            },
        hraExemption: isNew
          ? { ...hra, annualRentPaid: 0, calculatedExemption: 0 }
          : {
              ...hra,
              calculatedExemption: hraCalculated,
            },
        section80CCD_1B: isNew ? 0 : Number(nps) || 0,
        homeLoanInterest80EE: isNew ? 0 : Number(homeLoan) || 0,
        totalDeductionsDeclared: totalDeductions,
        estimatedTaxPayable: isNew ? newTax.total : oldTax.total,
      });

      if (res.success) {
        setDeclaration(res.declaration);
        setFeedback('Tax declarations updated and submitted successfully for payroll verification.');
      }
    } catch (err: any) {
      setFeedback(`Failed: ${err.message || 'Error saving tax declaration'}`);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Prints only the Form 16 certificate.
   * Opens a popup with the certificate + the app's styles, so it works even
   * where window.print() is blocked (e.g. sandboxed iframe previews).
   * Falls back to window.print() (with the @media print rules) if the popup
   * is blocked.
   */
  const handlePrintForm16 = () => {
    const el = document.getElementById('form16-print');
    if (!el) return;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      window.print();
      return;
    }

    const styles = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style')
    )
      .map((node) =>
        node instanceof HTMLLinkElement
          ? `<link rel="stylesheet" href="${node.href}">`
          : node.outerHTML
      )
      .join('\n');

    w.document.open();
    w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Form 16 - ${user?.firstName ?? ''} ${user?.lastName ?? ''}</title>
    ${styles}
    <style>
      body { background: #fff; padding: 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
      @page { margin: 12mm; }
    </style>
  </head>
  <body>
    ${el.outerHTML}
  </body>
</html>`);
    w.document.close();

    w.onload = () =>
      setTimeout(() => {
        w.focus();
        w.print();
      }, 500);
  };

  const handlePrintForm27A = () => {
    const el = document.getElementById('form27a-print');
    if (!el) return;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      window.print();
      return;
    }

    const styles = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style')
    )
      .map((node) =>
        node instanceof HTMLLinkElement
          ? `<link rel="stylesheet" href="${node.href}">`
          : node.outerHTML
      )
      .join('\n');

    w.document.open();
    w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Form 27A - Quarterly Statement</title>
    ${styles}
    <style>
      body { background: #fff; padding: 24px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
      @page { margin: 12mm; }
    </style>
  </head>
  <body>
    ${el.outerHTML}
  </body>
</html>`);
    w.document.close();

    w.onload = () =>
      setTimeout(() => {
        w.focus();
        w.print();
      }, 500);
  };

  return (
    <div className="space-y-6">
      {/* Fallback print rules: used only if the popup is blocked and window.print() runs */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #form16-print, #form16-print *, #form27a-print, #form27a-print * { visibility: visible !important; }
          #form16-print, #form27a-print {
            position: absolute !important;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            border: none !important;
          }
          html, body {
            height: auto !important;
            overflow: visible !important;
          }
        }
      `}</style>

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">Tax & TDS Compliance</span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Tax Declarations, Form 16 & Form 27A
          </h1>
        </div>
      </div>

      {/* Recruitment-style Tab Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { id: 'declaration', label: 'Tax Declarations & Regimes' },
          { id: 'form16', label: 'Form 16 Certificates' },
          { id: 'form27a', label: 'Form 27A & Form 24Q Filing' },
          { id: 'comparator', label: 'Tax Regime Comparator' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              activeTab === t.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: TAX DECLARATIONS FORM */}
      {activeTab === 'declaration' && (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Regime Selector */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Select Income Tax Regime</h3>
                <p className="text-xs text-slate-500">Financial Year 2025-2026 (Assessment Year 2026-2027)</p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-slate-100 text-slate-700 font-mono">
                FY 2025-26
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                onClick={() => setRegime('NEW')}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                  regime === 'NEW'
                    ? 'border-emerald-600 bg-emerald-50/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 text-sm">New Tax Regime (Default)</span>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    regime === 'NEW' ? 'border-emerald-600' : 'border-slate-300'
                  }`}>
                    {regime === 'NEW' && <div className="w-2 h-2 rounded-full bg-emerald-600" />}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Concessional slab rates, zero tax up to ₹12,00,000 taxable income. The only deduction kept is employer NPS (14% of Basic); standard deduction, 80C, 80D, HRA etc. are not applicable.
                </p>
              </div>

              <div
                onClick={() => setRegime('OLD')}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                  regime === 'OLD'
                    ? 'border-emerald-600 bg-emerald-50/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 text-sm">Old Tax Regime</span>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    regime === 'OLD' ? 'border-emerald-600' : 'border-slate-300'
                  }`}>
                    {regime === 'OLD' && <div className="w-2 h-2 rounded-full bg-emerald-600" />}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Permits comprehensive exemptions: 80C (up to ₹15,000), 80D medical insurance, HRA rent exemption, and home loan interest deductions.
                </p>
              </div>
            </div>
          </div>

          {/* NEW REGIME: only employer NPS (14% of Basic) */}
          {regime === 'NEW' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    Employer NPS Contribution - Section 80CCD(2)
                  </h3>
                  <p className="text-xs text-slate-500">
                    The only deduction under the New Regime. Auto-calculated as 14% of your Basic salary.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-400 uppercase">Recognized Total</span>
                  <p className="text-base font-bold text-emerald-600 font-mono">₹{fmt(npsEmployer)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Annual CTC (₹)</label>
                  <input
                    type="text"
                    disabled
                    value={fmt(annualCtc)}
                    className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Basic Salary - 23.9% of CTC (₹)</label>
                  <input
                    type="text"
                    disabled
                    value={fmt(basicYearly)}
                    className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">NPS - 14% of Basic (₹)</label>
                  <input
                    type="text"
                    disabled
                    value={fmt(npsEmployer)}
                    className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-500"
                  />
                </div>
              </div>
              {annualCtc <= 0 && (
                <p className="text-xs text-amber-600">
                  No annual CTC found for your profile, so NPS is shown as ₹0.
                </p>
              )}
            </div>
          )}

          {regime === 'OLD' && (
            <>
          {/* Section 80C Investments */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Section 80C Deductions (Maximum Cap: ₹15,000)
                </h3>
                <p className="text-xs text-slate-500">Provident Fund, Equity Linked Saving Scheme, Life Insurance, PPF</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-slate-400 uppercase">Recognized Total</span>
                <p className="text-base font-bold text-emerald-600 font-mono">₹{total80C.toLocaleString()} / ₹15,000</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Employee PF (Auto-deducted)</label>
                <input
                  type="number"
                  disabled
                  value={sec80C.epf}
                  className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Public Provident Fund (PPF)</label>
                <input
                  type="number"
                  value={sec80C.ppf}
                  onChange={(e) => setSec80C({ ...sec80C, ppf: Number(e.target.value) || 0 })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ELSS Mutual Funds</label>
                <input
                  type="number"
                  value={sec80C.elss}
                  onChange={(e) => setSec80C({ ...sec80C, elss: Number(e.target.value) || 0 })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Life Insurance Premium</label>
                <input
                  type="number"
                  value={sec80C.lifeInsurance}
                  onChange={(e) => setSec80C({ ...sec80C, lifeInsurance: Number(e.target.value) || 0 })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">5-Year Tax Saver Fixed Deposit</label>
                <input
                  type="number"
                  value={sec80C.taxSaverFD}
                  onChange={(e) => setSec80C({ ...sec80C, taxSaverFD: Number(e.target.value) || 0 })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 80D & HRA Exemption */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Section 80D - Health Insurance
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Self, Spouse & Children (₹)</label>
                  <input
                    type="number"
                    value={sec80D.selfSpouseChildren}
                    onChange={(e) => setSec80D({ ...sec80D, selfSpouseChildren: Number(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parents (Senior Citizens) (₹)</label>
                  <input
                    type="number"
                    value={sec80D.parents}
                    onChange={(e) => setSec80D({ ...sec80D, parents: Number(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                House Rent Allowance (HRA) Exemption
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Annual Rent Paid (₹)</label>
                  <input
                    type="number"
                    value={hra.annualRentPaid}
                    onChange={(e) => setHra({ ...hra, annualRentPaid: Number(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Landlord PAN</label>
                    <input
                      type="text"
                      value={hra.landlordPan}
                      onChange={(e) => setHra({ ...hra, landlordPan: e.target.value })}
                      className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">City Classification</label>
                    <select
                      value={hra.cityType}
                      onChange={(e) => setHra({ ...hra, cityType: e.target.value as any })}
                      className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
                    >
                      <option value="METRO">Metro (50% Basic)</option>
                      <option value="NON_METRO">Non-Metro (40% Basic)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Submitting Declarations...' : 'Save & Submit Tax Declarations'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: COMPARATOR */}
      {activeTab === 'comparator' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Tax Regime Comparison Engine</h2>
              <p className="text-xs text-slate-500">Live side-by-side calculation of your tax liability under both statutory models.</p>
            </div>
          </div>

          {annualCtc <= 0 && (
            <p className="text-xs text-amber-600">
              No annual CTC found for your profile, so the comparison below shows zero values.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-900 text-sm">New Regime (FY 2026-27)</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                    newTax.total <= oldTax.total ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {newTax.total <= oldTax.total ? 'Optimal Choice' : 'Alternative'}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Gross CTC</span>
                  <span className="font-mono font-medium">₹{fmt(annualCtc)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Employer NPS 80CCD(2) (14% of Basic ₹{fmt(basicYearly)})</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(npsEmployer)}</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-sm text-slate-900">
                  <span>Taxable Income</span>
                  <span className="font-mono">₹{fmt(newTaxable)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax as per slabs</span>
                  <span className="font-mono">₹{fmt(newTax.slabTax)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Rebate u/s 87A</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(newTax.rebate)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Health & Education Cess (4%)</span>
                  <span className="font-mono">₹{fmt(newTax.cess)}</span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-100/60 text-emerald-900 font-bold flex justify-between items-center text-sm">
                  <span>Estimated Annual Tax</span>
                  <span className="font-mono text-base">₹{fmt(newTax.total)}</span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-900 text-sm">Old Regime (With Exemptions)</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                    oldTax.total < newTax.total ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {oldTax.total < newTax.total ? 'Optimal Choice' : 'Alternative'}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Gross CTC</span>
                  <span className="font-mono font-medium">₹{fmt(annualCtc)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Standard Deduction</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(STANDARD_DEDUCTION_OLD)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Section 80C Total</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(total80C)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Section 80D Total</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(total80D)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>HRA Exemption Recognized</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(hraCalculated)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>NPS 80CCD(1B) + Home Loan Interest</span>
                  <span className="font-mono text-emerald-600">-₹{fmt((Number(nps) || 0) + (Number(homeLoan) || 0))}</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-sm text-slate-900">
                  <span>Taxable Income</span>
                  <span className="font-mono">₹{fmt(oldTaxable)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax as per slabs</span>
                  <span className="font-mono">₹{fmt(oldTax.slabTax)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Rebate u/s 87A</span>
                  <span className="font-mono text-emerald-600">-₹{fmt(oldTax.rebate)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Health & Education Cess (4%)</span>
                  <span className="font-mono">₹{fmt(oldTax.cess)}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-200 text-slate-900 font-bold flex justify-between items-center text-sm">
                  <span>Estimated Annual Tax</span>
                  <span className="font-mono text-base">₹{fmt(oldTax.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FORM 16 CERTIFICATE */}
      {activeTab === 'form16' && (
        <div
          id="form16-print"
          className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 space-y-6 print:p-0 print:border-none"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-6 gap-4">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">
                FORM NO. 16 (PART A & B)
              </span>
              <h2 className="text-lg font-bold text-slate-900">Certificate of Tax Deducted at Source (TDS)</h2>
              <p className="text-xs text-slate-500">Under section 203 of the Income-tax Act, 1961 for Salary</p>
            </div>

            <div className="flex items-center gap-3 print:hidden">
              {user?.role === 'ADMIN' && form24QData && form24QData.employees && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 font-medium">Select Employee:</span>
                  <select
                    value={form16EmpIndex}
                    onChange={(e) => setForm16EmpIndex(Number(e.target.value))}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white font-medium text-slate-800"
                  >
                    {form24QData.employees.map((emp, i) => (
                      <option key={i} value={i}>{emp.name} ({emp.PAN})</option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={handlePrintForm16}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs shadow-xs hover:bg-slate-800"
              >
                <Printer className="w-4 h-4" />
                Print Form 16
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl text-xs border border-slate-100">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Employer (Deductor)</span>
              <p className="font-semibold text-slate-900">{form24QData?.company.name || 'SCALEO9 SOFTWARE SOLUTIONS (OPC) PVT LTD'}</p>
              <p className="text-slate-500 text-[11px] font-mono">TAN: {form24QData?.company.TAN || 'PNES96307B'}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Employee (Deductee)</span>
              <p className="font-semibold text-slate-900">{form24QData?.employees?.[form16EmpIndex]?.name || `${user?.firstName} ${user?.lastName}`}</p>
              <p className="text-slate-500 text-[11px] font-mono">PAN: {form24QData?.employees?.[form16EmpIndex]?.PAN || 'ABCDE1234F'}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Assessment Year</span>
              <p className="font-semibold text-slate-900 font-mono">2026-2027</p>
              <p className="text-slate-500 text-[11px]">Period: {form24QData?.employees?.[form16EmpIndex]?.periodFrom || '2025-04-01'} to {form24QData?.employees?.[form16EmpIndex]?.periodTo || '2026-03-31'}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Filing Status (Q4)</span>
              <p className="font-semibold text-emerald-600 font-mono">{form24QData?.filingSummary.status || 'Filed'}</p>
              <p className="text-slate-500 text-[11px]">Total Tax Deposited: ₹{fmt(form24QData?.filingSummary.totalTaxDeposited || 238861)}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="bg-slate-50 p-3 font-bold border-b border-slate-200">
                PART B - Details of Salary Paid and Tax Deducted Thereon
              </div>
              <div className="p-4 space-y-3 font-mono text-slate-700">
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span>1. Gross Salary Paid / Credited</span>
                  <span className="font-bold text-slate-900">₹{fmt(form24QData?.employees?.[form16EmpIndex]?.salaryPaid || 1140000)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span>2. Less: Standard Deduction u/s 16(ia)</span>
                  <span className="text-emerald-600">-₹{fmt(form24QData?.employees?.[form16EmpIndex]?.standardDeduction || 75000)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span>3. Less: Chapter VI-A Deductions (Section 80C)</span>
                  <span className="text-emerald-600">-₹{fmt(form24QData?.employees?.[form16EmpIndex]?.section80C || 150000)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2 font-bold text-slate-900 bg-slate-50 p-2 rounded">
                  <span>4. Taxable Income</span>
                  <span>₹{fmt(Math.max(0, (form24QData?.employees?.[form16EmpIndex]?.salaryPaid || 1140000) - (form24QData?.employees?.[form16EmpIndex]?.standardDeduction || 75000) - (form24QData?.employees?.[form16EmpIndex]?.section80C || 150000)))}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span>5. Tax Payable on Total Income</span>
                  <span>₹{fmt(form24QData?.employees?.[form16EmpIndex]?.tdsDeducted || 229672)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 bg-emerald-50/60 p-3 rounded-lg text-sm">
                  <span>6. Net TDS Deducted & Deposited by Employer</span>
                  <span className="text-emerald-700">₹{fmt(form24QData?.employees?.[form16EmpIndex]?.tdsDeducted || 229672)}</span>
                </div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="bg-slate-50 p-3 font-bold border-b border-slate-200">
                PART A - Summary of Challan Deposits (Form 24Q Q4)
              </div>
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">Challan Deposit Date</th>
                    <th className="py-2 px-3">Bank & BSR Details</th>
                    <th className="py-2 px-3">Tax (₹)</th>
                    <th className="py-2 px-3">Cess (₹)</th>
                    <th className="py-2 px-3">Total Deposited (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {form24QData?.challans.map((c, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">{c.date}</td>
                      <td className="py-2 px-3 text-slate-600">{c.bank}</td>
                      <td className="py-2 px-3">₹{fmt(c.tax)}</td>
                      <td className="py-2 px-3">₹{fmt(c.cess)}</td>
                      <td className="py-2 px-3 font-bold text-emerald-600">₹{fmt(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FORM 27A & FORM 24Q FILING */}
      {activeTab === 'form27a' && form24QData && (
        <div
          id="form27a-print"
          className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 space-y-6 print:p-0 print:border-none"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-6 gap-4">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">
                FORM NO. 27A [See rule 37B]
              </span>
              <h2 className="text-lg font-bold text-slate-900">Quarterly Statement of Deduction of Tax under Section 200(3)</h2>
              <p className="text-xs text-slate-500">Income-tax Rules, 1962 — Form 24Q Control Statement (Q4 FY 2025-26)</p>
            </div>

            <div className="flex items-center gap-3 print:hidden">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Status:</span>
                <select
                  value={form24QData.filingSummary.status}
                  onChange={(e) => handleUpdateStatus(e.target.value as any)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-slate-800"
                >
                  <option value="Draft">Draft</option>
                  <option value="Filed">Filed</option>
                  <option value="Acknowledged">Acknowledged</option>
                </select>
              </div>

              <button
                onClick={handleValidateTDS}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold"
              >
                Validate TDS
              </button>

              <button
                type="button"
                onClick={handlePrintForm27A}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs shadow-xs hover:bg-slate-800"
              >
                <Printer className="w-4 h-4" />
                Print Form 27A
              </button>
            </div>
          </div>

          {/* Validation Result Banner */}
          {validationResult && (
            <div className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between print:hidden ${validationResult.isValid ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  {validationResult.isValid ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
                  <span>{validationResult.isValid ? 'TDS Validation Successful (100% Match)' : 'TDS Discrepancy Found'}</span>
                </div>
                <p>{validationResult.messages.join(' ')}</p>
              </div>
              <div className="font-mono text-right">
                <div>Employee TDS: ₹{fmt(validationResult.totalEmployeeTds)}</div>
                <div>Deposited: ₹{fmt(validationResult.totalChallanDeposited)}</div>
              </div>
            </div>
          )}

          {/* PART I - Deductor & Control Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Part I — Deductor Identification</span>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">1. TAN</span>
                <span className="font-mono font-bold text-slate-900">{form24QData.company.TAN}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">2. Company Name</span>
                <span className="font-bold text-slate-900">{form24QData.company.name}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">3. Financial Year / Quarter</span>
                <span className="font-mono text-slate-900">{form24QData.company.FY} ({form24QData.company.quarter})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">4. Assessment Year</span>
                <span className="font-mono text-slate-900">2026-2027</span>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Part II — Control Totals & Summaries</span>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">5. Total Number of Challans</span>
                <span className="font-mono font-bold text-slate-900">{form24QData.challans.length}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">6. Total Amount Paid / Credited</span>
                <span className="font-mono font-bold text-slate-900">₹{fmt(form24QData.filingSummary.amountPaid)}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">7. Total Tax Deposited</span>
                <span className="font-mono font-bold text-emerald-600">₹{fmt(form24QData.filingSummary.totalTaxDeposited)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">8. Total Deductees</span>
                <span className="font-mono font-bold text-slate-900">{form24QData.filingSummary.totalDeductees} Records</span>
              </div>
            </div>
          </div>

          {/* Challan Breakdown */}
          <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
            <div className="bg-slate-50 p-3 font-bold border-b border-slate-200 flex items-center justify-between">
              <span>Challan Deposit Records</span>
              <span className="text-slate-500 font-normal">FVU Version 9.5</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">Deposit Date</th>
                  <th className="py-2 px-3">Bank Details</th>
                  <th className="py-2 px-3">Tax (₹)</th>
                  <th className="py-2 px-3">Cess (₹)</th>
                  <th className="py-2 px-3">Total Deposited (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {form24QData.challans.map((c, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3">{c.date}</td>
                    <td className="py-2 px-3 text-slate-600">{c.bank}</td>
                    <td className="py-2 px-3">₹{fmt(c.tax)}</td>
                    <td className="py-2 px-3">₹{fmt(c.cess)}</td>
                    <td className="py-2 px-3 font-bold text-emerald-600">₹{fmt(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Employee Deductees Breakdown */}
          <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
            <div className="bg-slate-50 p-3 font-bold border-b border-slate-200">
              Employee Deduction Annexure ({form24QData.employees.length} Deductees)
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">Employee Name</th>
                  <th className="py-2 px-3">PAN</th>
                  <th className="py-2 px-3">Period</th>
                  <th className="py-2 px-3">Salary Paid (₹)</th>
                  <th className="py-2 px-3">80C (₹)</th>
                  <th className="py-2 px-3">TDS Deducted (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {form24QData.employees.map((emp, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-semibold text-slate-900 font-sans">{emp.name}</td>
                    <td className="py-2 px-3">{emp.PAN}</td>
                    <td className="py-2 px-3 text-slate-500 text-[11px]">{emp.periodFrom} to {emp.periodTo}</td>
                    <td className="py-2 px-3">₹{fmt(emp.salaryPaid)}</td>
                    <td className="py-2 px-3">₹{fmt(emp.section80C)}</td>
                    <td className="py-2 px-3 font-bold text-slate-900">₹{fmt(emp.tdsDeducted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Verification Box */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
            <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Verification</span>
            <p className="text-slate-600">
              I, Gaurav Madhukar Mahajan, hereby certify that all particulars furnished above are correct and complete in accordance with the provisions of the Income-tax Act, 1961 and Rules made thereunder.
            </p>
            <div className="pt-4 flex justify-between items-end">
              <div>
                <p className="text-[11px] text-slate-500">Place: Bengaluru</p>
                <p className="text-[11px] text-slate-500">Date: {new Date().toISOString().split('T')[0]}</p>
              </div>
              <div className="text-right">
                <div className="font-bold text-slate-900">Gaurav Madhukar Mahajan</div>
                <div className="text-[11px] text-slate-500">Authorized Signatory</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};