import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Header,
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Badge,
  Table,
  Modal,
  Alert,
  Input,
  Select,
  Loading,
  EmptyState,
  Status,
} from '../components';
import { api, APIClient } from '../utils/api';
import '../styles/dashboard.css';

export const Dashboard = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [waitlist, setWaitlist] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState(null);
  const [exitReason, setExitReason] = useState('hired');
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Load data
  const loadData = async () => {
    if (!jobId) {
      setError('No job selected');
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      setError('');
      
      const [jobData, waitlistData, eventsData] = await Promise.all([
        api.getJob(jobId),
        api.getWaitlist(jobId),
        api.getEventLog(jobId, 50, 0),
      ]);

      setJob(jobData.job);
      setWaitlist(waitlistData.waitlist);
      setEvents(eventsData.events);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load data');
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Poll every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [jobId]);

  const handleExitClick = (applicant) => {
    setSelectedApplicant(applicant);
    setExitReason('hired');
    setShowExitModal(true);
  };

  const handleExitSubmit = async () => {
    if (!selectedApplicant) return;

    try {
      await api.exitApplicant(selectedApplicant.applicant_id, exitReason);
      setShowExitModal(false);
      setSelectedApplicant(null);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to exit applicant');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <Header />
        <div className="page-content">
          <Loading text="Loading dashboard..." />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="page">
        <Header />
        <div className="page-content">
          <EmptyState
            icon="😕"
            title="Job Not Found"
            description="The job you're looking for doesn't exist."
            action={<Button onClick={() => navigate('/')}>Back to Home</Button>}
          />
        </div>
      </div>
    );
  }

  const activeCount = job.pipeline_snapshot?.active || 0;
  const waitlistCount = job.pipeline_snapshot?.waitlisted || 0;
  const decayedCount = job.pipeline_snapshot?.decayed_waitlisted || 0;
  const capacity = job.job?.active_cap || 0;

  return (
    <div className="page">
      <Header />
      <div className="page-content">
        <PageHeader
          title={job.job?.title}
          subtitle={`Company: ${job.job?.company_id} • Capacity: ${activeCount}/${capacity}`}
          action={
            <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={loadData}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '13px', alignSelf: 'center' }}>
                Updated {formatTimeSince(lastUpdate)}
              </span>
            </div>
          }
        />

        {error && (
          <Alert
            variant="error"
            message={error}
            onClose={() => setError('')}
            icon="⚠️"
          />
        )}

        {/* Stats Grid */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">Active</div>
            <div style={{ fontSize: '12px', marginTop: '8px', color: 'var(--color-text-tertiary)' }}>
              of {capacity} capacity
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{waitlistCount}</div>
            <div className="stat-label">Waitlisted</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{decayedCount}</div>
            <div className="stat-label">Decayed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{activeCount + waitlistCount + decayedCount}</div>
            <div className="stat-label">Total</div>
          </div>
        </div>

        <div className="grid grid-2">
          {/* Active Applicants */}
          <Card>
            <CardHeader
              title="Active Applicants"
              subtitle={`${activeCount} candidates in consideration`}
            />
            <CardBody>
              {job.pipeline_snapshot?.active === 0 ? (
                <EmptyState
                  icon="🎯"
                  title="No Active Applicants"
                  description="No one is currently being considered."
                />
              ) : (
                <div className="applicant-list">
                  {/* Note: In production, you'd fetch full applicant details */}
                  {Array.from({ length: Math.min(activeCount, 3) }).map((_, i) => (
                    <div key={i} className="list-item">
                      <div className="flex-between">
                        <div>
                          <div className="list-item-primary">Applicant {i + 1}</div>
                          <div className="list-item-secondary">applicant{i + 1}@example.com</div>
                        </div>
                        <Status type="active" label="Active" />
                      </div>
                      <div style={{ marginTop: 'var(--spacing-sm)', display: 'flex', gap: 'var(--spacing-sm)' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleExitClick({ applicant_id: `app-${i}`, name: `Applicant ${i + 1}` })}
                        >
                          Exit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Waitlist */}
          <Card>
            <CardHeader
              title="Waitlist"
              subtitle={`${waitlistCount + decayedCount} candidates waiting`}
            />
            <CardBody>
              {waitlistCount + decayedCount === 0 ? (
                <EmptyState
                  icon="🎉"
                  title="No Waitlist"
                  description="All candidates are active!"
                />
              ) : (
                <div className="waitlist">
                  {waitlist.slice(0, 5).map((applicant) => (
                    <div key={applicant.applicant_id} className="waitlist-item">
                      <div className="waitlist-position">#{applicant.position}</div>
                      <div style={{ flex: 1 }}>
                        <div className="list-item-primary">{applicant.name}</div>
                        <div className="list-item-secondary">{applicant.email}</div>
                      </div>
                      <Badge variant={applicant.status === 'decayed_waitlisted' ? 'warning' : 'info'}>
                        {applicant.status === 'decayed_waitlisted' ? 'Decayed' : 'Waiting'}
                      </Badge>
                    </div>
                  ))}
                  {waitlistCount + decayedCount > 5 && (
                    <div style={{ padding: 'var(--spacing-md)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
                      +{waitlistCount + decayedCount - 5} more in queue
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Event Log */}
        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader
            title="Pipeline Events"
            subtitle="Complete audit trail of all state changes"
          />
          <CardBody>
            <div className="event-log">
              {events.length === 0 ? (
                <EmptyState icon="📋" title="No Events" description="No pipeline events yet." />
              ) : (
                events.slice(0, 10).map((event, idx) => (
                  <div key={idx} className="event-item">
                    <div className="event-icon" data-type={event.event_type}>
                      {getEventIcon(event.event_type)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="event-title">
                        <strong>{event.applicant_name}</strong>
                        {' '}
                        <span>{getEventDescription(event.event_type)}</span>
                      </div>
                      <div className="event-meta">
                        {event.applicant_email} • {APIClient.formatDate(event.created_at)}
                      </div>
                    </div>
                    <Badge variant={getEventBadgeVariant(event.event_type)}>
                      {event.event_type}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Exit Modal */}
      <Modal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        title="Exit Applicant"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowExitModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleExitSubmit}>
              Confirm Exit
            </Button>
          </>
        }
      >
        {selectedApplicant && (
          <div>
            <p style={{ marginBottom: 'var(--spacing-md)' }}>
              Are you sure you want to exit <strong>{selectedApplicant.name}</strong>?
            </p>
            <Select
              label="Reason"
              value={exitReason}
              onChange={setExitReason}
              options={[
                { value: 'hired', label: 'Hired' },
                { value: 'withdrew', label: 'Withdrew' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

function formatTimeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes === 0) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

function getEventIcon(type) {
  const icons = {
    APPLIED: '📋',
    PROMOTED: '🚀',
    ACKNOWLEDGED: '✅',
    EXITED: '👋',
    DECAYED: '⏰',
  };
  return icons[type] || '•';
}

function getEventDescription(type) {
  const descriptions = {
    APPLIED: 'applied to the position',
    PROMOTED: 'was promoted to active',
    ACKNOWLEDGED: 'acknowledged the promotion',
    EXITED: 'exited the pipeline',
    DECAYED: 'was moved back to waitlist',
  };
  return descriptions[type] || 'updated';
}

function getEventBadgeVariant(type) {
  const variants = {
    APPLIED: 'info',
    PROMOTED: 'success',
    ACKNOWLEDGED: 'success',
    EXITED: 'danger',
    DECAYED: 'warning',
  };
  return variants[type] || 'info';
}
