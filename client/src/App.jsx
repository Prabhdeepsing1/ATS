import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { ApplicantStatus } from './pages/ApplicantStatus';
import './styles/globals.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard/:jobId" element={<Dashboard />} />
        <Route path="/applicant/:applicantId" element={<ApplicantStatus />} />
      </Routes>
    </Router>
  );
}

export default App;
