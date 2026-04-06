/**
 * Mensajes del script Process-AdUserQueue.ps1 cuando rechaza por cédula / EmployeeID duplicado en AD.
 */
export function isAdScriptDuplicateEmployeeIdMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('misma cédula') ||
    m.includes('misma cedula') ||
    m.includes('employeeid') ||
    m.includes('cédula / employeeid') ||
    m.includes('cedula / employeeid')
  );
}
