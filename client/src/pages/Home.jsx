import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Header,
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  Input,
  Modal,
  Alert,
  Loading,
} from '../components';
import { api } from '../utils/api';
import '../styles/home.css';

export const Home = () => {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create Job Form
  const [jobForm, setJobForm] = useState({
    company_id: '',
    title: '',
    active_cap: '5',
    decay_window: '48 hours',
  });

  // Apply Form
  const [applyForm, setApplyForm] = useState({
    jobId: '',
    name: '',
    email: '',
    phone: '',
  });

  const handleCreateJob = async () => {
    if (!jobForm.company_id || !jobForm.title || !jobForm.active_cap) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const result = await api.createJob({
        company_id: jobForm.company_id,
        title: jobForm.title,
        active_cap: parseInt(jobForm.active_cap, 10),
        decay_window: jobForm.decay_window,
      });

      setSuccess(`✓ Job created! ID: ${result.id}`);
      setShowCreateModal(false);
      setJobForm({ company_id: '', title: '', active_cap: '5', decay_window: '48 hours' });

      // Navigate to dashboard
      setTimeout(() => {
        navigate(`/dashboard/${result.id}`);
      }, 500);
    } catch (err) {
      setError(err.message || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!applyForm.jobId || !applyForm.name || !applyForm.email) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const result = await api.applyToJob(applyForm.jobId, {
        name: applyForm.name,
        email: applyForm.email,
        phone: applyForm.phone || undefined,
      });

      const statusMsg = result.promoted
        ? '🎉 Congratulations! You\'ve been promoted to active status!'
        : '📋 Your application has been received. You\'re on the waitlist.';

      setSuccess(`✓ Application submitted! ${statusMsg}`);
      setShowApplyModal(false);
      setApplyForm({ jobId: '', name: '', email: '', phone: '' });

      // Navigate to status page
      setTimeout(() => {
        navigate(`/applicant/${result.applicant.id}`);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to apply');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <Header />
      <div className="page-content">
        <PageHeader
          title="Welcome to QueueGate"
          subtitle="Modern, event-sourced ATS pipeline management"
        />

        {error && (
          <Alert
            variant="error"
            message={error}
            onClose={() => setError('')}
            icon="⚠️"
          />
        )}

        {success && (
          <Alert
            variant="success"
            message={success}
            onClose={() => setSuccess('')}
            icon="✅"
          />
        )}

        <div className="hero-grid">
          {/* For Companies */}
          <Card className="hero-card">
            <CardHeader title="👔 For Hiring Teams" />
            <CardBody>
              <p>Manage your entire hiring pipeline in one place. Track applicants, set active capacity,
                and automatically manage waitlists with intelligent decay.</p>

              <div className="feature-list">
                <div className="feature-item">✓ Real-time pipeline management</div>
                <div className="feature-item">✓ Automatic capacity management</div>
                <div className="feature-item">✓ Intelligent decay system</div>
                <div className="feature-item">✓ Full audit trail</div>
              </div>
            </CardBody>
            <div style={{ marginTop: 'var(--spacing-lg)', paddingTop: 'var(--spacing-lg)', borderTop: '1px solid var(--color-border)' }}>
              <Button
                variant="primary"
                block
                onClick={() => setShowCreateModal(true)}
              >
                Create a Job Opening
              </Button>
            </div>
          </Card>

          {/* For Applicants */}
          <Card className="hero-card">
            <CardHeader title="📝 For Applicants" />
            <CardBody>
              <p>Track your application status in real-time. Get instant updates when you're promoted,
                see your queue position, and acknowledge your status with one click.</p>

              <div className="feature-list">
                <div className="feature-item">✓ Real-time status updates</div>
                <div className="feature-item">✓ Queue position tracking</div>
                <div className="feature-item">✓ Decay countdown timer</div>
                <div className="feature-item">✓ Application timeline</div>
              </div>
            </CardBody>
            <div style={{ marginTop: 'var(--spacing-lg)', paddingTop: 'var(--spacing-lg)', borderTop: '1px solid var(--color-border)' }}>
              <Button
                variant="accent"
                block
                onClick={() => setShowApplyModal(true)}
              >
                Apply to a Position
              </Button>
            </div>
          </Card>
        </div>

        {/* How It Works */}
        <Card style={{ marginTop: 'var(--spacing-2xl)' }}>
          <CardHeader title="⚙️ How It Works" />
          <CardBody>
            <div className="how-it-works">
              <div className="how-step">
                <div className="step-number">1</div>
                <h4>Create Position</h4>
                <p>Set up a job opening with active capacity and decay window.</p>
              </div>

              <div className="how-step">
                <div className="step-number">2</div>
                <h4>Applicants Apply</h4>
                <p>Users submit applications and get promoted or waitlisted based on capacity.</p>
              </div>

              <div className="how-step">
                <div className="step-number">3</div>
                <h4>Acknowledge Status</h4>
                <p>Promoted candidates acknowledge their status within the decay window.</p>
              </div>

              <div className="how-step">
                <div className="step-number">4</div>
                <h4>Automatic Cascade</h4>
                <p>Non-responders are moved back; next in line gets promoted automatically.</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Architecture Highlight */}
        <div className="grid grid-2" style={{ marginTop: 'var(--spacing-2xl)' }}>
          <Card>
            <CardHeader title="🏗️ Event-Sourced Architecture" />
            <CardBody>
              <p>Every state change is an immutable event. Full auditability. Complete history. Full transparency.</p>
              <ul style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                <li>✓ APPLIED - application submitted</li>
                <li>✓ PROMOTED - moved to active</li>
                <li>✓ ACKNOWLEDGED - confirmed status</li>
                <li>✓ DECAYED - unresponsive</li>
                <li>✓ EXITED - hired/withdrew</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="🔒 Race Condition Safe" />
            <CardBody>
              <p>PostgreSQL advisory locks ensure zero double-promotions, even with millions of concurrent requests.</p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', marginTop: 'var(--spacing-md)' }}>
                Database-level serialization. Multi-process safe. Production-ready.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Create Job Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Job Opening"
        size="md"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowCreateModal(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateJob} disabled={loading}>
              {loading ? 'Creating...' : 'Create Job'}
            </Button>
          </>
        }
      >
        <div>
          <Input
            label="Company ID"
            placeholder="company-name or UUID"
            value={jobForm.company_id}
            onChange={(val) => setJobForm({ ...jobForm, company_id: val })}
          />
          <Input
            label="Job Title"
            placeholder="e.g., Senior Backend Engineer"
            value={jobForm.title}
            onChange={(val) => setJobForm({ ...jobForm, title: val })}
          />
          <Input
            label="Active Capacity"
            type="number"
            value={jobForm.active_cap}
            onChange={(val) => setJobForm({ ...jobForm, active_cap: val })}
          />
          <div className="form-group">
            <label>Decay Window</label>
            <select
              value={jobForm.decay_window}
              onChange={(e) => setJobForm({ ...jobForm, decay_window: e.target.value })}
              style={{ width: '100%', padding: 'var(--spacing-sm) var(--spacing-md)', fontSize: '14px', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
            >
              <option>24 hours</option>
              <option>48 hours</option>
              <option>72 hours</option>
              <option>1 week</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Apply Modal */}
      <Modal
        isOpen={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        title="Apply to a Position"
        size="md"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowApplyModal(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="accent" onClick={handleApply} disabled={loading}>
              {loading ? 'Applying...' : 'Apply Now'}
            </Button>
          </>
        }
      >
        <div>
          <Input
            label="Job ID"
            placeholder="Paste the job UUID"
            value={applyForm.jobId}
            onChange={(val) => setApplyForm({ ...applyForm, jobId: val })}
          />
          <Input
            label="Full Name"
            placeholder="John Doe"
            value={applyForm.name}
            onChange={(val) => setApplyForm({ ...applyForm, name: val })}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="john@example.com"
            value={applyForm.email}
            onChange={(val) => setApplyForm({ ...applyForm, email: val })}
          />
          <Input
            label="Phone (Optional)"
            type="tel"
            placeholder="+1-555-0000"
            value={applyForm.phone}
            onChange={(val) => setApplyForm({ ...applyForm, phone: val })}
          />
        </div>
      </Modal>
    </div>
  );
};
