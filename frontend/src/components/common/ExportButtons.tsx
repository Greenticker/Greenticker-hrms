import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';

interface ExportButtonsProps {
  onExportExcel: () => void;
  onExportPdf: () => void;
  title?: string;
  disabled?: boolean;
  className?: string;
}

export const ExportButtons: React.FC<ExportButtonsProps> = ({
  onExportExcel,
  onExportPdf,
  title = 'Export',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`relative inline-block ${className}`}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onExportExcel}
          disabled={disabled}
          type="button"
          className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs cursor-pointer border border-emerald-800 disabled:opacity-50"
          title="Export to Excel Spreadsheet (.xlsx)"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
          <span>Excel</span>
        </button>

        <button
          onClick={onExportPdf}
          disabled={disabled}
          type="button"
          className="px-3 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs cursor-pointer border border-rose-800 disabled:opacity-50"
          title="Export to Formatted PDF Document (.pdf)"
        >
          <FileText className="w-3.5 h-3.5 text-rose-200" />
          <span>PDF</span>
        </button>
      </div>
    </div>
  );
};
