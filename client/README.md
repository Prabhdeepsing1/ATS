# QueueGate Client

Modern React frontend for the QueueGate event-sourced ATS pipeline management system.

## Design

- **Framework**: React 18 with React Router
- **Styling**: Vanilla CSS with custom design system
- **Architecture**: Single Page Application (SPA) with responsive layout
- **Design System**:
  - Color palette: Indigo (primary) + Cyan (accent) with dark slate background
  - Typography: Inter (body) + Poppins (headings)
  - Smooth transitions and animations
  - Mobile-first responsive design

## Features

### Home Page
- Overview of the platform
- Quick start buttons for companies and applicants
- "How It Works" explanation
- Links to create jobs and apply to positions

### Company Dashboard (`/dashboard/:jobId`)
- Real-time pipeline snapshot (active, waitlisted, decayed counts)
- Active applicants list with quick actions
- Ordered waitlist with queue positions
- Full pipeline event log with audit trail
- Exit applicant functionality with reason dropdown
- Auto-refresh every 30 seconds with last-update timestamp

### Applicant Status (`/applicant/:applicantId`)
- Current status display with visual indicator
- Queue position (if waitlisted)
- Decay countdown timer (if active)
- Application timeline
- One-click promotion acknowledgment
- Status-specific next steps and guidance

## Structure

```
client/
├── public/
│   └── index.html
├── src/
│   ├── pages/
│   │   ├── Home.jsx           # Landing page
│   │   ├── Dashboard.jsx       # Company dashboard
│   │   └── ApplicantStatus.jsx # Applicant status view
│   ├── components/
│   │   └── index.js            # All reusable components
│   ├── styles/
│   │   ├── globals.css         # Design system + base styles
│   │   ├── layout.css          # Header, modals, cards
│   │   ├── home.css            # Home page specific
│   │   ├── dashboard.css       # Dashboard specific
│   │   └── applicant.css       # Applicant page specific
│   ├── utils/
│   │   └── api.js              # API client and helpers
│   ├── App.jsx                 # Router setup
│   └── index.js                # Entry point
├── Dockerfile
├── package.json
└── .env.example
```

## Component Library

All components are in `src/components/index.js`:

### Layout
- `Header` - Sticky header with logo and navigation
- `PageHeader` - Page title with optional action
- `Card` - Content wrapper with borders
- `Modal` - Centered modal with overlay

### Form
- `Input` - Text input with label and error support
- `Select` - Dropdown select
- `Textarea` - Multi-line text input

### Data Display
- `Table` - Sortable table with custom render functions
- `Badge` - Status badges (success, warning, danger, info)
- `Status` - Status indicator with animated dot
- `Alert` - Alert messages (success, error, warning, info)

### Interactive
- `Button` - Primary/secondary/danger/success variants
- `Loading` - Spinner with text
- `EmptyState` - Empty state with icon and action
- `Countdown` - Animated countdown timer

## Colors

| Name | Hex | Usage |
|------|-----|-------|
| Primary | `#6366f1` | Main brand color (Indigo) |
| Accent | `#06b6d4` | Highlights and CTAs (Cyan) |
| Success | `#10b981` | Positive actions (Emerald) |
| Warning | `#f59e0b` | Caution (Amber) |
| Danger | `#ef4444` | Destructive (Red) |
| Background | `#0f172a` | Main BG (Dark slate) |
| Text | `#f1f5f9` | Primary text (Light) |
| Border | `#334155` | Dividers (Slate-700) |

## Development

### Install Dependencies
```bash
npm install
```

### Start Dev Server
```bash
npm start
```

Runs on `http://localhost:3000` with auto-reload.

### Build for Production
```bash
npm run build
```

Creates optimized production build in `build/` folder.

## API Integration

All API calls go through `src/utils/api.js`:

```javascript
import { api, APIClient } from './utils/api';

// Jobs
await api.createJob(data);
await api.getJob(jobId);
await api.applyToJob(jobId, data);

// Applicants
await api.getApplicantStatus(applicantId);
await api.acknowledgePromotion(applicantId);
await api.exitApplicant(applicantId, reason);
```

### Helper Methods
```javascript
// Format dates
APIClient.formatDate(isoDate);

// Format time durations
APIClient.formatTime(ms);

// Get color for status
APIClient.getStatusColor(status);

// Get readable label
APIClient.getStatusLabel(status);
```

## Polling Strategy

- **Dashboard**: Polls every 30 seconds (`GET /api/jobs/:jobId`)
- **Applicant Status**: Polls every 60 seconds (`GET /api/applicants/:id/status`)

Polling intervals match domain cadence. Hiring workflows are measured in hours/days, so 30-60s polls are indistinguishable from real-time.

## Responsive Design

- Desktop (1024px+): Full layout with sidebars
- Tablet (768-1023px): Collapsible navigation, adjusted grids
- Mobile (<768px): Single column, touch-optimized buttons

All CSS uses custom properties for consistent spacing and sizing. Media queries at 768px and 480px breakpoints.

## Docker

```dockerfile
# Build stage compiles React
# Production stage serves with 'serve' package
# Output: http://localhost:3000
```

Run with Docker Compose:
```bash
docker compose up --build
```

## Performance

- **CSS**: Vanilla CSS (no build overhead)
- **Bundle**: Minimal dependencies (React, React-Router only)
- **Caching**: API responses cached in component state
- **Animations**: GPU-accelerated CSS transitions
- **Images**: Emoji-based icons (no image assets)

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Future Enhancements

- [ ] WebSocket support for real-time updates
- [ ] Dark mode toggle
- [ ] Email notification settings
- [ ] Bulk applicant actions
- [ ] Advanced filtering/search
- [ ] Analytics dashboard
- [ ] Export to CSV/PDF
- [ ] Multi-language support

## License

MIT
