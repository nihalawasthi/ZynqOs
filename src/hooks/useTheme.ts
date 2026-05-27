import { useState, useEffect } from 'react';

export function useTheme() {
  const [isLightMode, setIsLightMode] = useState<boolean>(false);

  useEffect(() => {
    // 1. Check for saved user preference in localStorage
    const savedTheme = localStorage.getItem('os-theme');
    
    // 2. Check the host machine's system preference
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;

    // Apply light mode if the user previously saved it, 
    // or if they have no save but their actual computer is in light mode.
    if (savedTheme === 'light' || (!savedTheme && prefersLight)) {
      setIsLightMode(true);
      document.documentElement.classList.add('light-mode');
    }
  }, []);

  const toggleTheme = () => {
    setIsLightMode((prev) => {
      const newValue = !prev;
      
      if (newValue) {
        document.documentElement.classList.add('light-mode');
        localStorage.setItem('os-theme', 'light');
      } else {
        document.documentElement.classList.remove('light-mode');
        localStorage.setItem('os-theme', 'dark');
      }
      
      return newValue;
    });
  };

  return { isLightMode, toggleTheme };
}