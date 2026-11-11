'use client';

import { useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeMaterial,
  type ColDef,
  type GetRowIdParams,
  type RowClassParams,
} from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Material look in the dashboard's colours: zebra rows, green accent. */
const theme = themeMaterial.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  // Colours from the page's tokens, so the light and dark themes both apply.
  foregroundColor: 'var(--color-ink)',
  headerTextColor: 'var(--color-ink-soft)',
  backgroundColor: 'var(--color-paper-sunk)',
  headerBackgroundColor: 'var(--color-paper-sunk)',
  oddRowBackgroundColor: 'var(--grid-odd)',
  rowHoverColor: 'var(--grid-hover)',
  selectedRowBackgroundColor: 'var(--grid-selected)',
  accentColor: 'var(--color-accent)',
  borderColor: 'var(--color-rule)',
  wrapperBorderRadius: 16,
  spacing: 6,
  rowHeight: 40,
  headerHeight: 44,
});

/** Georgian words of the column menus and filters. */
const KA: Record<string, string> = {
  applyFilter: 'გამოყენება',
  clearFilter: 'გასუფთავება',
  resetFilter: 'განულება',
  cancelFilter: 'გაუქმება',
  filterOoo: 'ფილტრი…',
  empty: 'აირჩიე',
  equals: 'ტოლია',
  notEqual: 'არ უდრის',
  lessThan: 'ნაკლები',
  greaterThan: 'მეტი',
  inRange: 'შუალედში',
  inRangeStart: 'დან',
  inRangeEnd: 'მდე',
  lessThanOrEqual: 'ნაკლები ან ტოლი',
  greaterThanOrEqual: 'მეტი ან ტოლი',
  contains: 'შეიცავს',
  notContains: 'არ შეიცავს',
  startsWith: 'იწყება',
  endsWith: 'მთავრდება',
  blank: 'ცარიელი',
  notBlank: 'არა ცარიელი',
  before: 'მანამდე',
  after: 'შემდეგ',
  andCondition: 'და',
  orCondition: 'ან',
  noRowsToShow: 'ჩანაწერი არ არის',
  loadingOoo: 'იტვირთება…',
  page: 'გვერდი',
  of: '/',
  to: '–',
  pageSizeSelectorLabel: 'გვერდზე:',
  sortAscending: 'ზრდადი',
  sortDescending: 'კლებადი',
  sortUnSort: 'სორტის მოხსნა',
  pinColumn: 'მიმაგრება',
  autosizeThisColumn: 'ზომის მორგება',
  autosizeAllColumns: 'ყველა სვეტის მორგება',
  resetColumns: 'სვეტების განულება',
  columnFilter: 'ფილტრი',
};

/**
 * One data table for the manager module (AG Grid Community, Material theme):
 * zebra rows, sort and a filter in every column header, a quick search over
 * all columns, CSV download and an optional totals row pinned at the bottom.
 */
export default function DataGrid<T extends object>({
  rows,
  columns,
  height = 560,
  totals,
  pinnedTop,
  fileName = 'table',
  rowId,
  rowClass,
  search = true,
  toolbar,
  context,
}: {
  rows: T[];
  columns: ColDef<T>[];
  /** Pixels; 'auto' grows with the rows (short lists). */
  height?: number | 'auto';
  totals?: Partial<T>[];
  /** Rows kept on top whatever the sort (e.g. what is still to count). */
  pinnedTop?: Partial<T>[];
  fileName?: string;
  rowId?: (row: T) => string;
  rowClass?: (p: RowClassParams<T>) => string | undefined;
  search?: boolean;
  toolbar?: React.ReactNode;
  /** Passed to cell components (e.g. what the viewer may change). */
  context?: unknown;
}) {
  const grid = useRef<AgGridReact<T>>(null);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(rows.length);
  const defaultColDef = useMemo<ColDef<T>>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 70,
      floatingFilter: false,
      suppressHeaderMenuButton: false,
    }),
    [],
  );
  // Long Georgian headers get cut: the full name shows on hover. Cells drawn
  // by a component are centred vertically like text cells.
  const cols = useMemo(
    () =>
      columns.map((c) => ({
        headerTooltip: c.headerName || undefined,
        ...(c.cellRenderer && !c.cellStyle
          ? { cellStyle: { display: 'flex', alignItems: 'center' } }
          : {}),
        ...c,
      })),
    [columns],
  );
  return (
    <div className="grid gap-2">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ძებნა ცხრილში…"
              className="min-w-0 flex-1 rounded-full border border-rule bg-paper px-4 py-2 text-sm focus:border-accent focus:outline-none sm:max-w-xs"
            />
          )}
          <span className="text-xs text-ink-faint tabular-nums">
            {shown === rows.length ? `${rows.length} ჩანაწერი` : `${shown} / ${rows.length}`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            <button
              type="button"
              onClick={() =>
                grid.current?.api.exportDataAsCsv({
                  fileName: `${fileName}.csv`,
                  skipPinnedBottom: false,
                })
              }
              className="rounded-full border border-rule-strong px-3 py-1.5 text-xs font-medium hover:bg-ink/5"
            >
              ⬇ CSV
            </button>
          </div>
        </div>
      )}
      <div style={height === 'auto' ? undefined : { height }}>
        <AgGridReact<T>
          ref={grid}
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={defaultColDef}
          localeText={KA}
          quickFilterText={q}
          pinnedBottomRowData={totals as T[] | undefined}
          pinnedTopRowData={pinnedTop as T[] | undefined}
          domLayout={height === 'auto' ? 'autoHeight' : 'normal'}
          getRowId={rowId ? (p: GetRowIdParams<T>) => rowId(p.data) : undefined}
          getRowClass={rowClass}
          animateRows={false}
          enableCellTextSelection
          ensureDomOrder
          context={context}
          onModelUpdated={(e) => setShown(e.api.getDisplayedRowCount())}
        />
      </div>
    </div>
  );
}
