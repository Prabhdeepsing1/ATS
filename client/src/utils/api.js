/**
 * API Client for QueueGate Backend
 * Handles all HTTP communication with the server
 */

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class APIError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'APIError';
  }
}

async function request(method, endpoint, data = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      throw new APIError(
        result.error?.code || 'UNKNOWN_ERROR',
        result.error?.message || 'An error occurred',
        response.status
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError('NETWORK_ERROR', error.message || 'Network error', 0);
  }
}

export const api = {
  // Jobs
  createJob: (data) =>
    request('POST', '/jobs', data),

  getJob: (jobId) =>
    request('GET', `/jobs/${jobId}`),

  applyToJob: (jobId, data) =>
    request('POST', `/jobs/${jobId}/apply`, data),

  getWaitlist: (jobId) =>
    request('GET', `/jobs/${jobId}/waitlist`),

  getEventLog: (jobId, limit = 100, offset = 0) =>
    request('GET', `/jobs/${jobId}/events?limit=${limit}&offset=${offset}`),

  // Applicants
  getApplicantStatus: (applicantId) =>
    request('GET', `/applicants/${applicantId}/status`),

  acknowledgePromotion: (applicantId) =>
    request('POST', `/applicants/${applicantId}/acknowledge`),

  exitApplicant: (applicantId, reason) =>
    request('POST', `/applicants/${applicantId}/exit`, { reason }),
};

export class APIClient {
  static formatDate(isoDate) {
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  static formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  static getStatusColor(status) {
    const colors = {
      active: 'success',
      acknowledged: 'success',
      waitlisted: 'warning',
      decayed_waitlisted: 'warning',
      exited: 'danger',
    };
    return colors[status] || 'info';
  }

  static getStatusLabel(status) {
    const labels = {
      active: 'Active',
      acknowledged: 'Acknowledged',
      waitlisted: 'Waitlisted',
      decayed_waitlisted: 'Decayed',
      exited: 'Exited',
    };
    return labels[status] || status;
  }
}
