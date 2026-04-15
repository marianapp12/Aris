/**
 * Genera plantilla-administrativos.xlsx en frontend/public (desde backend: node scripts/generatePlantillaAdministrativos.mjs).
 * Ciudad: valores como en el formulario (Segovia, Medellín, Bogotá, PSN, Marmato, Lower Mine; compat. Overmain/Overmine).
 *
 * ADVERTENCIA: este script SOBRESCRIBE el .xlsx completo. No ejecutarlo si ya tiene una plantilla
 * corporativa con estilos, tablas o validaciones en ese path; copie su archivo a otro sitio antes,
 * o use VITE_PLANTILLA_ADMINISTRATIVOS_URL en el frontend para servir la plantilla desde SharePoint u otra URL.
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../frontend/public');
const outFile = path.join(outDir, 'plantilla-administrativos.xlsx');

const rows = [
  ['CREACIÓN DE USUARIOS - ADMINISTRATIVOS (COLA AD)', '', '', '', '', '', '', '', ''],
  [
    'Primer Nombre',
    'Segundo Nombre',
    'Primer Apellido',
    'Segundo Apellido',
    'Puesto',
    'Departamento',
    'Cedula',
    'Ciudad',
    'Codigo postal',
  ],
  ['Juan', '', 'Pérez', '', 'Analista', 'TI', '12345678', 'Medellín', '050021'],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Administrativos');

fs.mkdirSync(outDir, { recursive: true });
XLSX.writeFile(wb, outFile);
console.log('Escrito:', outFile);
