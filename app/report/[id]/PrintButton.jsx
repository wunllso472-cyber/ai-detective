'use client';

export default function PrintButton() {
  return (
    <button className="btn" onClick={() => window.print()}>
      打印 / 存为 PDF
    </button>
  );
}
