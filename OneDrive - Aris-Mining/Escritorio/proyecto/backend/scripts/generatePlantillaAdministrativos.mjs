/**
 * Genera plantilla-administrativos.xlsx en frontend/public (desde carpeta backend: node scripts/generatePlantillaAdministrativos.mjs).
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../frontend/public');
const outFile = path.join(outDir, 'plantilla-administrativos.xlsx');

const rows = [
  ['CREACIÓN DE USUARIOS - ADMINISTRATIVOS (COLA AD)', '', '', '', '', '', '', ''],
  [
    'Primer Nombre',
    'Segundo Nombre',
    'Primer Apellido',
    'Segundo Apellido',
    'Puesto',
    'Departamento',
    'Cedula',
    'Ciudad',
  ],
  ['', '', '', '', '', '', '', ''],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Administrativos');

fs.mkdirSync(outDir, { recursive: true });
XLSX.writeFile(wb, outFile);
console.log('Escrito:', outFile);
