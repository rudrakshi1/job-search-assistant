/**
 * Candidate profile — personalised scoring configuration
 */

export const CANDIDATE = {
  name: "Rudrakshi Singhal",
  email: "singhalrudrakshi@gmail.com",
  phone: "+91 9837902962",
  linkedin: "linkedin.com/in/rudrakshi-singhal",
  currentCTC: "4500000",
  noticePeriod: "45 days — currently serving notice",
  availableFrom: "mid-May 2026",
  locations: ["Bengaluru", "Gurugram", "Mumbai", "Remote"],
  locationWeights: { "Bengaluru": 5, "Gurugram": 0, "Mumbai": 0, "Remote": 0 },
  workModes: ["office", "hybrid", "remote"],
  education: "B.Tech Production & Industrial Engineering, IIT Delhi, 2025, CGPA 8.75",
  targetRoles: ["Founder's Office", "Chief of Staff", "EIR", "Strategy & Operations", "VC Analyst", "VC Associate"],
  targetSectors: ["AI", "automation", "fintech", "supply chain", "consumer", "D2C"],
  background: "IIT Delhi Silver Medalist (8.75 CGPA, 2025). BCG Summer Associate 2024 — market sizing, operational frameworks, consumer and industrial sectors. Currently at Ola Electric Founders' Office (June 2025–present) working directly with founders on 0-to-1 strategic initiatives and EV market expansion. Founded ARIES AI Society at IIT Delhi. Published portfolio optimisation research on SSRN.",
  experience: [
    "Ola Electric Founders' Office (2025–present) — 0-to-1 strategic initiatives, direct founder access, EV market expansion",
    "BCG Summer Associate (2024) — market sizing, operational frameworks, consumer and industrial sectors",
    "Founded ARIES AI Society at IIT Delhi",
    "Published portfolio optimisation research on SSRN",
  ],
  whyFoundersOffice: "I want to work directly with founders because that is where real learning happens — understanding how decisions get made under uncertainty and how companies are built from scratch.",
  whyAI: "I am drawn to AI because it is reshaping how work gets done at a fundamental level. I want to be at the intersection of AI and business building.",
};

export const TOP_TIER_COMPANIES = [
  'peak xv', 'accel', 'sequoia', 'lightspeed', 'matrix partners',
  'kalaari', 'blume', 'nexus', 'elevation', 'tiger global',
  'leena ai', 'slintel', 'darwinbox', 'chargebee', 'postman',
];

export const TOP_TIER_INVESTORS = [
  'Peak XV', 'Accel', 'Sequoia', 'Lightspeed', 'Y Combinator',
  'Bessemer', 'Matrix', 'Kalaari', 'Blume', 'Nexus', 'B Capital', 'Greycroft',
];

export const HARD_FILTERS = {
  minBaseSalary: 3000000,
};

export const STORY_BANK = {
  founders_office: "I want to work directly with founders because that is where real learning happens — understanding how decisions get made under uncertainty and how companies are built from scratch.",
  why_ai: "I am drawn to AI because it is reshaping how work gets done at a fundamental level. I want to be at the intersection of AI and business building.",
  why_fintech: "Fintech is where I see the biggest opportunity for impact in India — financial inclusion at scale through better products.",
  why_supply_chain: "Supply chain is where Ola Electric gave me my deepest operational experience — I understand how physical and digital systems interact at scale.",
};
