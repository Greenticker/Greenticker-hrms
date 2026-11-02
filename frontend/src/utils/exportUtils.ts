import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ExportColumn<T> {
  header: string;
  key: keyof T | ((item: T) => string | number);
}

/**
 * Export generic array of objects or mapped columns to Excel (.xlsx) file
 */
export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  filename: string,
  sheetName = 'ReportData',
  columns?: ExportColumn<T>[]
) {
  let exportRows: Record<string, any>[] = [];

  if (columns && columns.length > 0) {
    exportRows = data.map((item) => {
      const row: Record<string, any> = {};
      columns.forEach((col) => {
        const val = typeof col.key === 'function' ? col.key(item) : item[col.key];
        row[col.header] = val ?? '';
      });
      return row;
    });
  } else {
    // Flatten or use direct objects
    exportRows = data.map((item) => {
      const row: Record<string, any> = {};
      Object.keys(item).forEach((k) => {
        if (typeof item[k] !== 'object' || item[k] === null) {
          row[k] = item[k];
        } else {
          row[k] = JSON.stringify(item[k]);
        }
      });
      return row;
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  
  // Auto-fit column widths
  const colWidths = Object.keys(exportRows[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...exportRows.map((r) => String(r[key] || '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const cleanFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, cleanFilename);
}

/**
 * Export tabular data to PDF (.pdf) file with standard corporate styling
 */
export function exportToPdf(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  filename: string,
  subtitle?: string
) {
  const doc = new jsPDF({
    orientation: headers.length > 6 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const timestamp = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Header Banner
  doc.setFillColor(2, 59, 119); // #023b77
  doc.rect(0, 0, doc.internal.pageSize.width, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('GREENTICKER FINANCIAL SERVICES', 14, 11);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('vetan.ai HR Enterprise Operating Portal', 14, 17);

  doc.text(`Generated: ${timestamp}`, doc.internal.pageSize.width - 14, 14, { align: 'right' });

  // Document Title & Subtitle
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), 14, 30);

  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(subtitle, 14, 36);
  }

  const startY = subtitle ? 40 : 34;

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: startY,
    theme: 'grid',
    headStyles: {
      fillColor: [3, 149, 131], // #039583
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    styles: {
      overflow: 'linebreak',
      cellPadding: 2.5,
    },
    didDrawPage: (data) => {
      // Footer
      const str = `Page ${data.pageNumber}`;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        str,
        doc.internal.pageSize.width - 14,
        doc.internal.pageSize.height - 10,
        { align: 'right' }
      );
      doc.text(
        'Confidential · Internal HR & Enterprise Record',
        14,
        doc.internal.pageSize.height - 10
      );
    },
  });

  const cleanFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(cleanFilename);
}
