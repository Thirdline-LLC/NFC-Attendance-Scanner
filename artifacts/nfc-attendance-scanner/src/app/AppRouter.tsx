import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ScannerScreen } from '@/scanner/ScannerScreen';

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route path="/" element={<ScannerScreen />} />
      </Routes>
    </BrowserRouter>
  );
}