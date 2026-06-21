'use client';
import { createContext } from 'react';

// Shared AI-meta for the analysis cards: the last-refresh timestamp (drives each
// card's countdown) and the refresh handler (each card's own ↻). Provided once
// around the tabs in page.js so cards don't thread it through every tab.
export const AiContext = createContext({ ts: null, refresh: null });
