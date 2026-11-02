'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Info, CheckCircle2, ShieldCheck } from 'lucide-react';

interface RoleOption {
  id: string;
  title: string;
  org: string;
  avatar: string;
}

const ROLES: RoleOption[] = [
  { id: 'analyst', title: 'Public Health Analyst', org: 'County Health Department', avatar: 'PA' },
  { id: 'manager', title: 'Program Manager', org: 'City Health Department', avatar: 'PM' },
  { id: 'admin', title: 'Data Administrator', org: 'Health Data Team', avatar: 'DA' },
];

export default function LoginPage() {
  const router = useRouter();
  const { user, login, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('analyst');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user, router]);

  const handleForgotPassword = () => {
    const trimmed = email.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setResetMessage(`In a production deployment, a reset link would be emailed to ${trimmed}. For this environment, please use your provisioned credentials.`);
    } else {
      setResetMessage('Enter your work email in the field above, then select Forgot password again.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
    setResetMessage('');

    const trimmedEmail = email.trim();
    let hasError = false;

    if (!trimmedEmail) {
      setEmailError('Enter your work email address.');
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError('Please enter a valid work email.');
      hasError = true;
    }

    if (!password) {
      setPasswordError('Enter your password.');
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError('Passwords must be at least 8 characters.');
      hasError = true;
    }

    if (hasError) return;

    setIsSubmitting(true);
    try {
      const res = await login(trimmedEmail, password, selectedRole, rememberMe);
      if (res.success) {
        router.replace('/');
      } else {
        setGeneralError(res.error || 'Invalid credentials. Please verify your email and password.');
      }
    } catch (err: any) {
      setGeneralError(err.message || 'An unexpected error occurred during sign-in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGeneralError('');
    setIsGoogleSubmitting(true);
    try {
      // Connect to MapWell Google SSO handler
      const res = await loginWithGoogle(
        {
          email: email.trim() || undefined,
          role: selectedRole
        },
        selectedRole,
        rememberMe
      );

      if (res.success) {
        router.replace('/');
      } else {
        setGeneralError(res.error || 'Google authentication failed.');
      }
    } catch (err: any) {
      setGeneralError(err.message || 'Google SSO failed to complete.');
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-y-auto bg-[radial-gradient(1000px_600px_at_90%_0%,rgba(14,165,233,0.12),transparent_60%),linear-gradient(180deg,#0a1324_0%,#050b14_100%)]">
      <div className="w-full max-w-[1240px] min-h-[640px] grid grid-cols-1 lg:grid-cols-[minmax(440px,500px)_1fr] gap-6 my-auto">
        
        {/* Left Column: Sign-in Card */}
        <section className="bg-[var(--surface-solid,#0f1c2e)] border border-[var(--line-strong,#1e3450)] rounded-3xl p-7 sm:p-10 flex flex-col justify-between shadow-2xl relative overflow-hidden backdrop-blur-xl">
          {/* Subtle Ambient Light */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--glow)] rounded-full blur-3xl pointer-events-none -mr-20 -mt-20 opacity-30" />

          {/* Brand Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <span className="text-[20px] font-black tracking-tight text-white">
                  Map<span className="text-[var(--cyan,#22d3ee)]">Well</span>
                </span>
                <span className="block text-[10px] font-bold tracking-wider text-[var(--faint,#64748b)] uppercase">
                  Community Health Mapping
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Production Atlas</span>
            </div>
          </div>

          {/* Form Content */}
          <div className="my-6">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Sign in to MapWell
            </h1>
            <p className="text-[13.5px] text-[var(--muted,#94a3b8)] mt-1.5 mb-6">
              Access community health indicators, tract-level maps and assessment workflows.
            </p>

            {generalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[13px] flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{generalError}</span>
              </div>
            )}

            {resetMessage && (
              <div className="mb-4 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-200 text-[12.5px] flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <span>{resetMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Role Selector */}
              <div>
                <label className="block text-[12px] font-semibold text-[var(--muted,#94a3b8)] uppercase tracking-wider mb-2">
                  Sign in as
                </label>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Sign in role">
                  {ROLES.map((r) => {
                    const isSelected = selectedRole === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelectedRole(r.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all relative ${
                          isSelected
                            ? 'border-[var(--cyan,#22d3ee)] bg-[var(--glow,#22d3ee1f)] ring-1 ring-[var(--cyan,#22d3ee)] shadow-md shadow-cyan-500/10'
                            : 'border-[var(--line,#1e293b)] bg-[var(--surface-2,#132238)] hover:border-[var(--line-strong,#334155)] opacity-80 hover:opacity-100'
                        }`}
                      >
                        <div className={`text-[12px] font-bold truncate ${isSelected ? 'text-[var(--cyan,#22d3ee)]' : 'text-white'}`}>
                          {r.title}
                        </div>
                        <div className="text-[10px] text-[var(--faint,#64748b)] truncate mt-0.5">
                          {r.org}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Work Email Field */}
              <div>
                <label className="block text-[12px] font-semibold text-[var(--muted,#94a3b8)] mb-1.5">
                  Work email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[var(--faint,#64748b)] absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    type="email"
                    id="login-email"
                    placeholder="analyst@health.gov"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError('');
                    }}
                    className={`w-full h-11 pl-10 pr-4 rounded-xl border bg-[var(--surface-2,#0d1829)] text-[13.5px] text-white placeholder-[var(--faint,#64748b)] outline-none transition-all ${
                      emailError
                        ? 'border-rose-500 ring-2 ring-rose-500/20'
                        : 'border-[var(--line,#1e293b)] focus:border-[var(--cyan,#22d3ee)] focus:ring-2 focus:ring-[var(--glow,#22d3ee2a)]'
                    }`}
                  />
                </div>
                {emailError && (
                  <p className="text-[11.5px] text-rose-400 mt-1 font-medium">{emailError}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-semibold text-[var(--muted,#94a3b8)]">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-[12px] font-medium text-[var(--cyan,#22d3ee)] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[var(--faint,#64748b)] absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="login-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    className={`w-full h-11 pl-10 pr-11 rounded-xl border bg-[var(--surface-2,#0d1829)] text-[13.5px] text-white placeholder-[var(--faint,#64748b)] outline-none transition-all ${
                      passwordError
                        ? 'border-rose-500 ring-2 ring-rose-500/20'
                        : 'border-[var(--line,#1e293b)] focus:border-[var(--cyan,#22d3ee)] focus:ring-2 focus:ring-[var(--glow,#22d3ee2a)]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-2.5 w-7 h-7 rounded-lg text-[var(--muted,#94a3b8)] hover:text-white flex items-center justify-center hover:bg-[var(--surface-solid,#1e293b)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-[11.5px] text-rose-400 mt-1 font-medium">{passwordError}</p>
                )}
              </div>

              {/* Remember Me Checkbox */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 accent-cyan-500 cursor-pointer"
                  />
                  <span className="text-[12.5px] text-[var(--muted,#94a3b8)]">
                    Keep me signed in for 30 days
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || isGoogleSubmitting}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-[14px] flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign in</span>
                )}
              </button>

              {/* Divider */}
              <div className="relative flex items-center justify-center my-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--line,#1e293b)]" />
                </div>
                <span className="relative bg-[var(--surface-solid,#0f1c2e)] px-3 text-[11px] font-bold text-[var(--faint,#64748b)] uppercase tracking-wider">
                  or
                </span>
              </div>

              {/* Continue with Google SSO */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting || isGoogleSubmitting}
                className="w-full h-11 rounded-xl border border-[var(--line-strong,#2a3b50)] bg-[var(--surface-2,#132238)] hover:bg-[var(--surface-solid,#1a2d46)] hover:border-cyan-500/40 text-white font-semibold text-[13.5px] flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer"
              >
                {isGoogleSubmitting ? (
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                )}
                <span>Continue with Google</span>
              </button>
            </form>
          </div>

          {/* Card Footer */}
          <div className="pt-4 border-t border-[var(--line,#1e293b)] flex flex-wrap items-center justify-between text-[11px] text-[var(--faint,#64748b)] gap-2">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              Role-based health intelligence
            </span>
            <span>MapWell Community Health v2.4</span>
          </div>
        </section>

        {/* Right Column: Geospatial Health Map Showcase */}
        <section className="hidden lg:flex flex-col justify-between relative rounded-3xl overflow-hidden border border-cyan-900/40 bg-gradient-to-br from-[#0c1e34] via-[#091527] to-[#040913] p-8 shadow-2xl">
          {/* Ambient Map Glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_50%,rgba(14,165,233,0.18),transparent_65%)] pointer-events-none" />

          {/* Header Copy */}
          <div className="relative z-10 max-w-lg">
            <h2 className="text-2xl font-bold tracking-tight text-white leading-snug">
              Census tract insight for every community you serve
            </h2>
            <p className="text-[13px] text-cyan-200/70 mt-2 leading-relaxed">
              Map social determinants, disease incidence and program utilization, pinpoint underserved neighborhoods, and translate findings directly into interventions.
            </p>
          </div>

          {/* Interactive Visual Map Graphic */}
          <div className="relative my-6 flex-1 flex items-center justify-center">
            <div className="relative w-full max-w-[460px] h-[300px]">
              {/* SVG Choropleth Graphic */}
              <svg className="w-full h-full drop-shadow-2xl" viewBox="0 0 500 320" fill="none">
                <defs>
                  <linearGradient id="map-poly-1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0284C7" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#0369A1" stopOpacity="0.6" />
                  </linearGradient>
                  <linearGradient id="map-poly-2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#0284C7" stopOpacity="0.7" />
                  </linearGradient>
                  <linearGradient id="map-poly-3" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.65" />
                  </linearGradient>
                  <linearGradient id="map-poly-4" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.7" />
                  </linearGradient>
                </defs>

                {/* Polygonal Tracts */}
                <polygon points="120,40 210,35 240,95 160,110 110,75" fill="url(#map-poly-1)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />
                <polygon points="210,35 320,45 350,115 240,95" fill="url(#map-poly-2)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />
                <polygon points="160,110 240,95 270,180 185,195 140,150" fill="url(#map-poly-3)" stroke="#38BDF8" strokeWidth="1.5" strokeOpacity="0.8" />
                <polygon points="240,95 350,115 375,190 270,180" fill="url(#map-poly-4)" stroke="#38BDF8" strokeWidth="1.5" strokeOpacity="0.9" />
                <polygon points="270,180 375,190 410,270 310,280" fill="url(#map-poly-2)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />
                <polygon points="185,195 270,180 310,280 215,285" fill="url(#map-poly-1)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />
                <polygon points="90,130 160,110 185,195 125,220" fill="url(#map-poly-2)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />
                <polygon points="125,220 185,195 215,285 130,275" fill="url(#map-poly-3)" stroke="#38BDF8" strokeWidth="1.2" strokeOpacity="0.6" />

                {/* Hotspot Indicators */}
                <circle cx="260" cy="140" r="14" fill="#F43F5E" fillOpacity="0.25" />
                <circle cx="260" cy="140" r="6" fill="#F43F5E" />
                <circle cx="260" cy="140" r="2.5" fill="#FFF" />

                <circle cx="330" cy="150" r="10" fill="#F59E0B" fillOpacity="0.25" />
                <circle cx="330" cy="150" r="4.5" fill="#F59E0B" />

                <circle cx="170" cy="155" r="9" fill="#06B6D4" fillOpacity="0.25" />
                <circle cx="170" cy="155" r="4" fill="#06B6D4" />
              </svg>

              {/* Floating County Badge (Top Right) */}
              <div className="absolute -top-2 right-2 bg-slate-900/90 border border-cyan-500/40 rounded-2xl p-3 shadow-xl backdrop-blur-md w-52">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold">
                    IL
                  </div>
                  <div className="text-[12px] font-bold text-white">Cook County, IL</div>
                </div>
                <div className="text-[10px] text-slate-400">Census tracts analyzed</div>
                <div className="text-[20px] font-black text-cyan-400 tracking-tight mt-0.5">
                  1,319
                </div>
              </div>

              {/* Floating Vulnerability Scale (Bottom Left) */}
              <div className="absolute -bottom-2 left-2 bg-slate-900/90 border border-slate-700/80 rounded-2xl p-3 shadow-xl backdrop-blur-md w-56">
                <div className="text-[11px] font-bold text-white mb-1.5 flex items-center justify-between">
                  <span>Community Vulnerability</span>
                  <span className="text-cyan-400 text-[10px]">SVI Index</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-rose-500" />
                <div className="flex justify-between text-[9px] text-slate-400 mt-1">
                  <span>Lowest (0.0)</span>
                  <span>Highest (1.0)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Capability Pills */}
          <div className="relative z-10 flex flex-wrap gap-2 pt-4 border-t border-cyan-900/40">
            {['Health Map', 'Tract Explorer', 'Disparities', 'Needs Assessments', 'Reports & Exports'].map((pill) => (
              <span
                key={pill}
                className="px-3 py-1 rounded-full text-[11.5px] font-semibold bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 backdrop-blur-sm"
              >
                {pill}
              </span>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
