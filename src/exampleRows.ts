export function resolveExampleBodyLine(rowLine: number | undefined, headerLine: number | undefined, rowIndex: number): number {
  if (rowLine && (!headerLine || rowLine > headerLine)) {
    return rowLine;
  }
  if (headerLine) {
    return headerLine + rowIndex + 1;
  }
  return rowLine ?? 1;
}
