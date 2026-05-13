// In-memory doctor directory + booking store used by the aiRender integration.
// The doctor list is owned locally; bookings are forwarded to aiRender's
// Schedule Meeting API and the response is cached here so the UI can re-render.
//
// `lat` / `lng` are real Ahmedabad-hospital coordinates so the patient's
// browser Geolocation can sort them by actual distance.
// `daysAhead` is how many days from today this doctor's next slot is:
//   0 = today, 1 = tomorrow, 2–6 = later this week.
// `slots` span morning → late-evening so the "upcoming only" filter always
// has at least a few visible options regardless of when the demo is run.

const DOCTORS = [
  // ── Available TODAY (daysAhead: 0) ────────────────────────────────────────
  {
    id: 'd1', name: 'Dr. Ananya Rao', initials: 'AR',
    specialty: 'Cardiologist',
    tags: ['heart', 'chest', 'cardio', 'bp', 'ecg', 'palpitation', 'blood pressure'],
    experience: 14, rating: 4.9, reviews: 312, fee: 800,
    daysAhead: 0,
    slots: ['08:00 AM', '09:00 AM', '10:30 AM', '12:00 PM', '02:00 PM', '03:30 PM', '05:00 PM', '06:30 PM', '08:00 PM', '09:30 PM'],
    hospital: 'Apollo Hospitals, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0461, lng: 72.5546,
    avatarBg: '#e8f0fe', avatarColor: '#1557b0',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd2', name: 'Dr. Suresh Kumar', initials: 'SK',
    specialty: 'General Physician',
    tags: ['fever', 'cold', 'flu', 'cough', 'general', 'weakness', 'body ache'],
    experience: 9, rating: 4.7, reviews: 198, fee: 500,
    daysAhead: 0,
    slots: ['07:30 AM', '08:30 AM', '09:30 AM', '11:00 AM', '01:00 PM', '02:30 PM', '04:00 PM', '06:00 PM', '07:30 PM', '09:00 PM', '10:00 PM'],
    hospital: 'Sterling Hospitals, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0395, lng: 72.5066,
    avatarBg: '#fce8e6', avatarColor: '#c5221f',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd4', name: 'Dr. Rajiv Patel', initials: 'RP',
    specialty: 'Dermatologist',
    tags: ['skin', 'acne', 'rash', 'eczema', 'hair', 'pimple', 'allergy'],
    experience: 7, rating: 4.8, reviews: 154, fee: 700,
    daysAhead: 0,
    slots: ['08:30 AM', '10:00 AM', '11:30 AM', '01:30 PM', '03:00 PM', '04:30 PM', '06:00 PM', '07:30 PM', '09:00 PM'],
    hospital: 'CIMS Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0496, lng: 72.5188,
    avatarBg: '#fef7e0', avatarColor: '#b06000',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd6', name: 'Dr. Arjun Shah', initials: 'AS',
    specialty: 'Orthopaedic',
    tags: ['bone', 'joint', 'knee', 'back', 'spine', 'fracture', 'shoulder', 'ankle'],
    experience: 12, rating: 4.6, reviews: 203, fee: 900,
    daysAhead: 0,
    slots: ['08:00 AM', '09:30 AM', '11:00 AM', '12:30 PM', '02:30 PM', '04:00 PM', '05:30 PM', '07:00 PM', '08:30 PM'],
    hospital: 'Zydus Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0732, lng: 72.5300,
    avatarBg: '#e1f5ee', avatarColor: '#085041',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd7', name: 'Dr. Kavita Desai', initials: 'KD',
    specialty: 'Pediatrician',
    tags: ['child', 'baby', 'pediatric', 'infant', 'vaccination', 'newborn', 'toddler'],
    experience: 10, rating: 4.9, reviews: 245, fee: 600,
    daysAhead: 0,
    slots: ['09:00 AM', '10:00 AM', '11:00 AM', '12:30 PM', '02:00 PM', '04:00 PM', '05:30 PM', '07:00 PM'],
    hospital: 'Shalby Hospitals, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0260, lng: 72.5147,
    avatarBg: '#fce8e6', avatarColor: '#a8001a',
    hostEmail: 'more.jayesh7777@gmail.com',
  },

  // ── Available TOMORROW (daysAhead: 1) ─────────────────────────────────────
  {
    id: 'd3', name: 'Dr. Priya Mehta', initials: 'PM',
    specialty: 'Psychiatrist',
    tags: ['anxiety', 'stress', 'sleep', 'mood', 'panic', 'depression', 'mental'],
    experience: 11, rating: 5.0, reviews: 87, fee: 1200,
    daysAhead: 1,
    slots: ['09:00 AM', '10:00 AM', '11:30 AM', '01:00 PM', '02:30 PM', '04:00 PM', '05:30 PM', '07:00 PM', '08:30 PM'],
    hospital: 'SAL Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0335, lng: 72.5260,
    avatarBg: '#e6f4ea', avatarColor: '#137333',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd8', name: 'Dr. Nilesh Trivedi', initials: 'NT',
    specialty: 'ENT Specialist',
    tags: ['ear', 'throat', 'nose', 'sinus', 'hearing', 'tonsil', 'sore throat'],
    experience: 13, rating: 4.7, reviews: 178, fee: 750,
    daysAhead: 1,
    slots: ['09:00 AM', '10:30 AM', '12:00 PM', '02:00 PM', '03:30 PM', '05:00 PM', '06:30 PM'],
    hospital: 'Narayana Multispeciality, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0410, lng: 72.4960,
    avatarBg: '#fef7e0', avatarColor: '#7a3f00',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd11', name: 'Dr. Ramesh Acharya', initials: 'RA',
    specialty: 'Gastroenterologist',
    tags: ['stomach', 'gastric', 'ulcer', 'acidity', 'indigestion', 'liver', 'gas', 'bloating'],
    experience: 17, rating: 4.8, reviews: 234, fee: 1100,
    daysAhead: 1,
    slots: ['08:30 AM', '10:00 AM', '11:30 AM', '01:30 PM', '03:00 PM', '04:30 PM', '06:00 PM'],
    hospital: 'Rajasthan Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0260, lng: 72.5793,
    avatarBg: '#f3e8fd', avatarColor: '#5b21b6',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd14', name: 'Dr. Pooja Khanna', initials: 'PK',
    specialty: 'Dentist',
    tags: ['tooth', 'teeth', 'dental', 'gum', 'cavity', 'braces', 'root canal'],
    experience: 8, rating: 4.9, reviews: 312, fee: 600,
    daysAhead: 1,
    slots: ['09:30 AM', '11:00 AM', '12:30 PM', '02:30 PM', '04:00 PM', '05:30 PM', '07:00 PM'],
    hospital: 'KD Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0540, lng: 72.5060,
    avatarBg: '#e8f0fe', avatarColor: '#0b5394',
    hostEmail: 'more.jayesh7777@gmail.com',
  },

  // ── Available THIS WEEK (daysAhead: 2–5) ──────────────────────────────────
  {
    id: 'd5', name: 'Dr. Meena Joshi', initials: 'MJ',
    specialty: 'Neurologist',
    tags: ['migraine', 'headache', 'brain', 'nerve', 'epilepsy', 'seizure', 'dizziness'],
    experience: 16, rating: 4.9, reviews: 267, fee: 1500,
    daysAhead: 2,
    slots: ['09:30 AM', '11:00 AM', '12:30 PM', '02:00 PM', '03:30 PM', '05:00 PM', '06:30 PM', '08:00 PM'],
    hospital: 'HCG Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0241, lng: 72.5562,
    avatarBg: '#f3e8fd', avatarColor: '#7b1fa2',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd9', name: 'Dr. Sneha Iyer', initials: 'SI',
    specialty: 'Gynecologist',
    tags: ['pregnancy', 'period', 'menstrual', 'ovary', 'pcod', 'pcos', 'maternity', 'women'],
    experience: 15, rating: 4.9, reviews: 421, fee: 1300,
    daysAhead: 2,
    slots: ['08:00 AM', '09:30 AM', '11:00 AM', '12:30 PM', '02:30 PM', '04:00 PM', '05:30 PM', '07:00 PM'],
    hospital: 'Marengo CIMS Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0501, lng: 72.5185,
    avatarBg: '#fce8e6', avatarColor: '#a73c5d',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd10', name: 'Dr. Vikram Bhatt', initials: 'VB',
    specialty: 'Ophthalmologist',
    tags: ['eye', 'vision', 'sight', 'lasik', 'cataract', 'glasses', 'retina'],
    experience: 18, rating: 4.8, reviews: 289, fee: 900,
    daysAhead: 3,
    slots: ['09:00 AM', '10:30 AM', '12:00 PM', '01:30 PM', '03:00 PM', '04:30 PM', '06:00 PM'],
    hospital: 'C.H. Nagri Eye Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0322, lng: 72.5701,
    avatarBg: '#e6f4ea', avatarColor: '#0b6e3a',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd12', name: 'Dr. Anita Nair', initials: 'AN',
    specialty: 'Endocrinologist',
    tags: ['diabetes', 'thyroid', 'hormone', 'insulin', 'sugar', 'pcos', 'obesity'],
    experience: 14, rating: 4.7, reviews: 187, fee: 1000,
    daysAhead: 3,
    slots: ['09:30 AM', '11:00 AM', '12:30 PM', '02:30 PM', '04:00 PM', '05:30 PM'],
    hospital: 'Manek Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0270, lng: 72.5660,
    avatarBg: '#fef7e0', avatarColor: '#866600',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd13', name: 'Dr. Sanjay Verma', initials: 'SV',
    specialty: 'Pulmonologist',
    tags: ['asthma', 'lung', 'breath', 'breathing', 'tuberculosis', 'wheezing', 'respiratory'],
    experience: 16, rating: 4.7, reviews: 213, fee: 1100,
    daysAhead: 4,
    slots: ['09:00 AM', '10:30 AM', '12:00 PM', '02:00 PM', '03:30 PM', '05:00 PM'],
    hospital: 'Wockhardt Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0150, lng: 72.5060,
    avatarBg: '#e8f0fe', avatarColor: '#1a3a8a',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
  {
    id: 'd15', name: 'Dr. Vishal Gandhi', initials: 'VG',
    specialty: 'Urologist',
    tags: ['kidney', 'urine', 'urinary', 'prostate', 'bladder', 'stone'],
    experience: 19, rating: 4.6, reviews: 156, fee: 1200,
    daysAhead: 5,
    slots: ['09:00 AM', '10:30 AM', '12:00 PM', '02:30 PM', '04:00 PM'],
    hospital: 'Civil Hospital, Ahmedabad', location: 'Ahmedabad',
    lat: 23.0561, lng: 72.5993,
    avatarBg: '#f3e8fd', avatarColor: '#6a1b9a',
    hostEmail: 'more.jayesh7777@gmail.com',
  },
];

// Simple in-memory bookings store (resets when server restarts).
const bookings = (typeof Map !== 'undefined') ? new Map() : null;

// Isomorphic export — works as a Node module AND a browser script tag.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DOCTORS, bookings };
} else if (typeof window !== 'undefined') {
    window.DOCTORS = DOCTORS;
}
