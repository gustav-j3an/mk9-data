// Isolated visual fixture. Authentication and API are mocked only by the test browser.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RhAbsencesView } from '../../src/views/RhAbsencesView';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<RhAbsencesView />);
