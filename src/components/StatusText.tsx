export function StatusLabel({ status }: { status: string }) {
  const map: Record<string, string> = {
    Available: 'text-emerald-700 font-semibold',
    Borrowed: 'text-blue-700 font-semibold',
    'Under Maintenance': 'text-amber-700 font-semibold',
    Missing: 'text-red-700 font-semibold',
    Disposed: 'text-slate-500 font-medium',
    Pending: 'text-amber-700 font-semibold',
    Released: 'text-blue-700 font-semibold',
    Returned: 'text-emerald-700 font-semibold',
    Rejected: 'text-red-700 font-semibold',
  };

  return <span className={`text-xs whitespace-nowrap ${map[status] || 'text-slate-700 font-medium'}`}>{status}</span>;
}

export function ConditionLabel({ condition }: { condition: string }) {
  const map: Record<string, string> = {
    Good: 'text-emerald-700 font-medium',
    Fair: 'text-slate-700 font-medium',
    'Needs Repair': 'text-amber-700 font-semibold',
    Damaged: 'text-red-700 font-semibold',
    Condemned: 'text-red-800 font-semibold',
  };

  return <span className={`text-xs whitespace-nowrap ${map[condition] || 'text-slate-700'}`}>{condition}</span>;
}
