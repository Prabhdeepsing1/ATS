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
  Modal,
  Alert,
  Loading,
  EmptyState,
  Status,
} from '../components';
import { api, APIClient } from '../utils/api';
import '../styles/applicant.css';

export const ApplicantStatus = () => {
  const { applicantId } = useParams();
  const navigate = useNavigate();
  const [applicant, setApplicant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAcknowledgeModal, setShowAcknowledgeModal] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Load applicant data
  const loadApplicant = async () => {
    if (!applicantId) {
      setError('No applicant selected');
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      setError('');

      const data = await api.getApplicantStatus(applicantId);
      setApplicant(data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load applicant status');
      console.error('Error loading applicant:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Update countdown every second
  useEffect(() => {
    if (!applicant?.time_until_decay_ms) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return applicant.time_until_decay_ms;
        const newTime = prev - 1000;
        return newTime <= 0 ? 0 : newTime;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [applicant?.time_until_decay_ms]);

  // Initial load
  useEffect(() => {
    loadApplicant();
    setCountdown(applicant?.time_until_decay_ms || null);

    // Poll every 60 seconds
    const interval = setInterval(loadApplicant, 60000);
    return () => clearInterval(interval);
  }, [applicantId]);

  // Handle acknowledge
  const handleAcknowledge = async () => {
    try {
      await api.acknowledgePromotion(applicantId);
      setShowAcknowledgeModal(false);
      setSuccess('✓ Promotion acknowledged! Good luck with your interview.');
      setTimeout(() => setSuccess(''), 5000);
      await loadApplicant();
    } catch (err) {
      setError(err.message || 'Failed to acknowledge');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <Header />
        <div className="page-content">
          <Loading text="Loading applicant status..." />
        </div>
      </div>
    );
  }

  if (!applicant) {
    return (
      <div className="page">
        <Header />
        <div className="page-content">
          <EmptyState
            icon="😕"
            title="Applicant Not Found"
            description="We couldn't find this applicant."
            action={<Button onClick={() => navigate('/')}>Back to Home</Button>}
          />
        </div>
      </div>
    );
  }

  const statusColor = APIClient.getStatusColor(applicant.status);
  const statusLabel = APIClient.getStatusLabel(applicant.status);
  const isActive = applicant.status === 'active';
  const isWaitlisted = applicant.status === 'waitlisted' || applicant.status === 'decayed_waitlisted';
  const isDecayed = applicant.status === 'decayed_waitlisted';
  const isExited = applicant.status === 'exited';

  const decayMinutes = countdown ? Math.floor(countdown / 1000 / 60) : 0;
  const decaySeconds = countdown ? Math.floor((countdown / 1000) % 60) : 0;

  return (
    <div className="page">
      <Header />
      <div className="page-content">
        <PageHeader
          title={applicant.name}
          subtitle={applicant.email}
          action={
            <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={loadApplicant}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
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

        {success && (
          <Alert
            variant="success"
            message={success}
            onClose={() => setSuccess('')}
            icon="✅"
          />
        )}

        {/* Status Overview */}
        <div className="status-hero">
          <div className="status-badge" data-status={applicant.status}>
            <Status
              type={statusColor}
              label={statusLabel}
            />
          </div>

          <h2 style={{ margin: '24px 0 8px 0' }}>
            {getStatusMessage(applicant.status)}
          </h2>

          <p className="text-muted">
            {getStatusDescription(applicant.status, applicant)}
          </p>

          {isActive && countdown !== null && (
            <div className={`countdown ${countdown < 3600000 ? (countdown < 1800000 ? 'danger' : 'warning') : ''}`}>
              ⏱️ Respond within{' '}
              <strong>
                {decayMinutes}m {decaySeconds}s
              </strong>
            </div>
          )}
        </div>

        <div className="grid grid-2">
          {/* Status Details */}
          <Card>
            <CardHeader title="Status Details" />
            <CardBody>
              <div className="data-row">
                <span className="data-row-label">Current Status</span>
                <Badge variant={statusColor}>{statusLabel}</Badge>
              </div>

              {isWaitlisted && (
                <div className="data-row">
                  <span className="data-row-label">Queue Position</span>
                  <span className="data-row-value">
                    #{applicant.queue_position}
                    {isDecayed && ` (Decayed, -${applicant.penalty_offset})`}
                  </span>
                </div>
              )}

              {applicant.promoted_at && (
                <>
                  <div className="data-row">
                    <span className="data-row-label">Promoted On</span>
                    <span className="data-row-value">
                      {APIClient.formatDate(applicant.promoted_at)}
                    </span>
                  </div>

                  {isActive && applicant.decay_deadline && (
                    <div className="data-row">
                      <span className="data-row-label">Decay Deadline</span>
                      <span className="data-row-value">
                        {APIClient.formatDate(applicant.decay_deadline)}
                      </span>
                    </div>
                  )}
                </>
              )}

              {isDecayed && (
                <div className="data-row">
                  <span className="data-row-label">Times Decayed</span>
                  <span className="data-row-value">{applicant.penalty_offset}</span>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Next Steps */}
          <Card>
            <CardHeader title="Next Steps" />
            <CardBody>
              {isActive && (
                <>
                  <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <h4 style={{ marginBottom: 'var(--spacing-md)' }}>✅ You\'re Active!</h4>
                    <p className="text-muted" style={{ fontSize: '14px', marginBottom: 'var(--spacing-md)' }}>
                      You've been selected to move forward in our hiring process. Please acknowledge your status
                      below to confirm you're ready to proceed.
                    </p>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                      <strong>Important:</strong> You have{' '}
                      <strong>{Math.floor(countdown / 1000 / 60 / 60)} hours</strong> to acknowledge your status.
                      If you don't respond, you'll be moved back to the waitlist.
                    </div>
                  </div>
                  <Button
                    variant="success"
                    block
                    onClick={() => setShowAcknowledgeModal(true)}
                    size="lg"
                  >
                    ✓ Acknowledge Promotion
                  </Button>
                </>
              )}

              {isWaitlisted && (
                <>
                  <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <h4 style={{ marginBottom: 'var(--spacing-md)' }}>
                      {isDecayed ? "⏰ You Were Moved Back" : "⏳ You're in the Queue"}
                    </h4>
                    <p className="text-muted" style={{ fontSize: '14px', marginBottom: 'var(--spacing-md)' }}>
                      {isDecayed
                        ? "You didn't respond to a previous promotion, so you've been moved back in the queue. Check back soon for new opportunities."
                        : "We have more candidates ahead of you. We'll reach out when it's your turn!"}
                    </p>
                    <p className="text-muted" style={{ fontSize: '13px' }}>
                      Queue Position: <strong>#{applicant.queue_position}</strong>
                    </p>
                  </div>
                  <Button variant="secondary" block disabled>
                    Waiting for Your Turn...
                  </Button>
                </>
              )}

              {isExited && (
                <>
                  <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <h4 style={{ marginBottom: 'var(--spacing-md)' }}>👋 Application Closed</h4>
                    <p className="text-muted" style={{ fontSize: '14px' }}>
                      Your application status has been finalized. Thank you for your time!
                    </p>
                  </div>
                  <Button variant="secondary" block disabled>
                    Application Closed
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Timeline */}
        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader title="Application Timeline" />
          <CardBody>
            <div className="timeline">
              <div className="timeline-item completed">
                <div className="timeline-marker">✓</div>
                <div className="timeline-content">
                  <div className="timeline-title">Applied</div>
                  <div className="timeline-date">Application submitted</div>
                </div>
              </div>

              {applicant.promoted_at && (
                <>
                  <div className={`timeline-item ${isActive || isWaitlisted || isExited ? 'completed' : ''}`}>
                    <div className="timeline-marker">✓</div>
                    <div className="timeline-content">
                      <div className="timeline-title">Promoted to Active</div>
                      <div className="timeline-date">
                        {APIClient.formatDate(applicant.promoted_at)}
                      </div>
                    </div>
                  </div>

                  {applicant.status === 'acknowledged' && (
                    <div className="timeline-item completed">
                      <div className="timeline-marker">✓</div>
                      <div className="timeline-content">
                        <div className="timeline-title">Acknowledged</div>
                        <div className="timeline-date">Confirmed status</div>
                      </div>
                    </div>
                  )}

                  {isDecayed && (
                    <div className="timeline-item completed">
                      <div className="timeline-marker">⏰</div>
                      <div className="timeline-content">
                        <div className="timeline-title">Moved to Waitlist</div>
                        <div className="timeline-date">No response before deadline</div>
                      </div>
                    </div>
                  )}

                  {isExited && (
                    <div className="timeline-item completed">
                      <div className="timeline-marker">👋</div>
                      <div className="timeline-content">
                        <div className="timeline-title">Application Closed</div>
                        <div className="timeline-date">Final status updated</div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {!applicant.promoted_at && (
                <div className="timeline-item">
                  <div className="timeline-marker">•</div>
                  <div className="timeline-content">
                    <div className="timeline-title">Waiting to be Promoted</div>
                    <div className="timeline-date">You're in the queue</div>
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Acknowledge Modal */}
      <Modal
        isOpen={showAcknowledgeModal}
        onClose={() => setShowAcknowledgeModal(false)}
        title="Acknowledge Promotion"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowAcknowledgeModal(false)}>
              Not Yet
            </Button>
            <Button variant="success" onClick={handleAcknowledge}>
              ✓ I Accept
            </Button>
          </>
        }
      >
        <div>
          <p style={{ marginBottom: 'var(--spacing-md)' }}>
            By clicking <strong>"I Accept"</strong>, you're confirming that you're ready to move forward in the
            hiring process.
          </p>
          <div style={{ 
            padding: 'var(--spacing-md)', 
            background: 'rgba(6, 182, 212, 0.1)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(6, 182, 212, 0.2)'
          }}>
            <p style={{ fontSize: '13px', marginBottom: 0 }}>
              ℹ️ You have until <strong>{APIClient.formatDate(applicant.decay_deadline)}</strong> to confirm. 
              After that, you'll be moved back to the waitlist.
            </p>
          </div>
        </div>
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

function getStatusMessage(status) {
  const messages = {
    active: '🚀 You\'re In!',
    acknowledged: '✅ All Set',
    waitlisted: '⏳ You\'re in Line',
    decayed_waitlisted: '⏰ Check Back Soon',
    exited: '👋 Thanks for Applying',
  };
  return messages[status] || 'Your Status';
}

function getStatusDescription(status, applicant) {
  const descriptions = {
    active: 'Congratulations! You\'ve been selected to move forward. Please acknowledge your status below.',
    acknowledged: 'Your status has been confirmed. Look for next steps in your email.',
    waitlisted: 'You\'re in our waiting list. We\'ll contact you if a spot opens up.',
    decayed_waitlisted: 'You didn\'t respond to your previous opportunity. You\'re back in the queue.',
    exited: 'Your application has been finalized. Thank you for your interest!',
  };
  return descriptions[status] || 'Waiting for updates';
}
