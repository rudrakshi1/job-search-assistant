/**
 * Candidate profile — personalised scoring configuration
 */

/**
 * Candidate profile — personalised scoring configuration
 * Replace with your own details before running
 */

export const CANDIDATE = {
  name: "Your Name",
  email: "your.email@gmail.com",
  phone: "+91 XXXXXXXXXX",
  linkedin: "linkedin.com/in/your-profile",
  currentCTC: "XX,00,000",
  noticePeriod: "XX days — currently serving notice",
  availableFrom: "Month Year",
  locations: ["Bengaluru", "Gurugram", "Mumbai", "Remote"],
  locationWeights: { "Bengaluru": 5, "Gurugram": 0, "Mumbai": 0, "Remote": 0 },
  workModes: ["office", "hybrid", "remote"],
  education: "Your degree, Institution, Year, CGPA",
  targetRoles: ["Founder's Office", "Chief of Staff", "EIR", "Strategy & Operations"],
  targetSectors: ["AI", "automation", "fintech", "supply chain", "consumer"],
  background: "Brief professional background for cover email generation",
  experience: [
    "Previous role 1 — key achievement",
    "Previous role 2 — key achievement",
  ],
  whyFoundersOffice: "Your reason for wanting founder-proximate roles",
  whyAI: "Your interest in AI/tech",
};

export const TOP_TIER_COMPANIES = [
  'peak xv', 'accel', 'sequoia', 'lightspeed', 'matrix partners',
  'kalaari', 'blume', 'nexus', 'elevation', 'tiger global',
];

export const TOP_TIER_INVESTORS = [
  'Peak XV', 'Accel', 'Sequoia', 'Lightspeed', 'Y Combinator',
  'Bessemer', 'Matrix', 'Kalaari', 'Blume', 'Nexus',
];

export const HARD_FILTERS = {
  minBaseSalary: X000000,
};

export const STORY_BANK = {
  founders_office: "I want to work directly with founders because that is where real learning happens.",
  why_ai: "I am drawn to AI because it is reshaping how work gets done at a fundamental level.",
};
