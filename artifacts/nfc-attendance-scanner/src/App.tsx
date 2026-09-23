import { AppRouter } from '@/app/AppRouter';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ThemeBanner } from '@/theme/ThemeBanner';

function App() {
  return (
    <ThemeProvider>
      <ThemeBanner />
      <AppRouter />
    </ThemeProvider>
  );
}

export default App;
