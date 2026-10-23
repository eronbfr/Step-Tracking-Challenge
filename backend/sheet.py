"""Mirror data/data.json into step-tracking_Team8.xlsx — run by the Ledger Action after every change.

* Sheet "Team X" keeps its original layout: one row per member (matched by name), one column per day.
  Only the day cells, the TOTAL column and the team-total row are (re)written, so formatting stays intact.
* Sheet "Log" lists every change from data/log.csv (newest first).

Usage: python backend/sheet.py [repo root]
"""
import csv
import datetime as dt
import json
import sys
import unicodedata
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
XLSX = ROOT / 'step-tracking_Team8.xlsx'
DATA = ROOT / 'data' / 'data.json'
LOG = ROOT / 'data' / 'log.csv'
HEADER_ROW = 2
STEPS_FORMAT = '#,##0'


def norm(value):
    text = unicodedata.normalize('NFKD', str(value or ''))
    return ''.join(c for c in text if not unicodedata.combining(c)).lower().strip()


def challenge_dates(ch):
    day = dt.date.fromisoformat(ch['start'])
    end = dt.date.fromisoformat(ch['end'])
    out = []
    while day <= end:
        out.append(day.isoformat())
        day += dt.timedelta(days=1)
    return out


def write_steps(ws, data):
    header = {norm(c.value): c.column for c in ws[HEADER_ROW] if isinstance(c.value, str)}
    name_col, total_col = header['name'], header['total']
    day_cols = {c.value.date().isoformat(): c.column for c in ws[HEADER_ROW] if isinstance(c.value, dt.datetime)}
    first_day, last_day = get_column_letter(min(day_cols.values())), get_column_letter(max(day_cols.values()))

    rows = {}
    r = HEADER_ROW + 1
    while ws.cell(r, name_col).value and not norm(ws.cell(r, name_col).value).startswith('total'):
        rows[norm(ws.cell(r, name_col).value)] = r
        r += 1
    first_row, last_row, total_row = HEADER_ROW + 1, r - 1, r

    dates = challenge_dates(data['challenge'])
    for m in data['members']:
        row = rows.get(norm(m['name']))
        if row is None:
            print(f'WARNING: {m["name"]} has no row in the spreadsheet — skipped')
            continue
        for i, day in enumerate(dates):
            col = day_cols.get(day)
            if col is None:
                continue
            cell = ws.cell(row, col)
            cell.value = m['daily'][i]
            cell.number_format = STEPS_FORMAT
        ws.cell(row, total_col).value = f'=SUM({first_day}{row}:{last_day}{row})'

    # Team totals cover every member row (the original sheet left the last member out).
    for col in day_cols.values():
        letter = get_column_letter(col)
        ws.cell(total_row, col).value = f'=SUM({letter}{first_row}:{letter}{last_row})'
    ws.cell(total_row, total_col).value = f'=SUM({first_day}{total_row}:{last_day}{total_row})'
    for row in range(first_row, total_row + 1):
        ws.cell(row, total_col).number_format = ws.cell(first_row, total_col).number_format

    stamp = dt.datetime.fromisoformat(data['updatedAt'].replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M UTC')
    ws['B1'] = f'Updated {stamp} by the Nokia - Step Challenge 2026 - Team 8 app'
    ws['B1'].font = Font(italic=True, color='767C93', size=9)


def write_log(wb):
    if 'Log' in wb.sheetnames:
        del wb['Log']
    ws = wb.create_sheet('Log')
    head = ['Time (UTC)', 'Member', 'Name', 'Event', 'Day', 'Steps', 'Previous', 'Source']
    ws.append(head)
    rows = []
    if LOG.exists():
        with LOG.open(encoding='utf-8', newline='') as f:
            rows = list(csv.DictReader(f))
    def num(v):
        return int(v) if v not in ('', None) else None

    for r in reversed(rows):
        when = r['time'][:19].replace('T', ' ')
        ws.append([when, r['member'], r['name'], r['event'], r['date'] or None, num(r['steps']), num(r['previous']), r['source'] or None])
    bold = Font(bold=True, color='FFFFFF')
    fill = PatternFill('solid', fgColor='1650D0')
    for c in ws[1]:
        c.font, c.fill, c.alignment = bold, fill, Alignment(horizontal='center')
    for row in ws.iter_rows(min_row=2, min_col=6, max_col=7):
        for c in row:
            c.number_format = STEPS_FORMAT
    for col, width in zip('ABCDEFGH', (20, 11, 24, 11, 12, 10, 10, 11)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = 'A2'


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    wb = load_workbook(XLSX)
    write_steps(wb.worksheets[0], data)
    write_log(wb)
    wb.active = 0
    wb.calculation.fullCalcOnLoad = True  # Excel/LibreOffice recompute the TOTAL formulas on open
    wb.save(XLSX)
    print(f'{XLSX.name} updated ({len(data["members"])} members)')


if __name__ == '__main__':
    main()
