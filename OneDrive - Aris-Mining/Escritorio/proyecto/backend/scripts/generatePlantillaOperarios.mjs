/**
 * Genera plantilla-operarios.xlsx en frontend/public (ejecutar desde carpeta backend: node scripts/generatePlantillaOperarios.mjs).
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../frontend/public');
const outFile = path.join(outDir, 'plantilla-operarios.xlsx');

const rows = [
  ['CREACIÓN DE USUARIOS - OPERARIOS', '', '', '', '', '', ''],
  [
    'Primer Nombre',
    'Segundo Nombre',
    'Primer Apellido',
    'Segundo Apellido',
    'Puesto',
    'Departamento',
    'Sede',
  ],
  ['', '', '', '', '', '', ''],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Operarios');

fs.mkdirSync(outDir, { recursive: true });
XLSX.writeFile(wb, outFile);
console.log('Escrito:', outFile);
