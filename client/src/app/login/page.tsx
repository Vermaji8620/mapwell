'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Info, Grid, Link as LinkIcon } from 'lucide-react';
import { LoginShowcaseMap } from '@/components/LoginShowcaseMap';

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
      setResetMessage(`In a live deployment, a reset link would be emailed to ${trimmed}. For this demo environment, please sign in with your provisioned credentials.`);
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
      setGeneralError(err.message || 'Single sign-on failed.');
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4 sm:p-5 flex items-center justify-center bg-[radial-gradient(1000px_600px_at_90%_0%,#ffffff,transparent_60%),linear-gradient(180deg,#EDF7FF_0%,#E3F2FF_100%)]">
      <div className="w-full max-w-[1260px] min-h-[620px] grid grid-cols-1 lg:grid-cols-[minmax(420px,490px)_1fr] gap-4 my-auto">
        
        {/* ================= Left Column: Sign-in Card ================= */}
        <section className="bg-[#15273C] border border-[#233954] rounded-[24px] shadow-[0_10px_30px_rgba(10,25,45,0.15)] p-6 sm:p-8 md:p-9 flex flex-col justify-between">
          
          {/* Brand Header */}
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 40 40" className="w-9 h-9 flex-shrink-0" aria-hidden="true">
              <path
                d="M20 3c-8 0-14 6-14 13.6C6 26 20 37 20 37s14-11 14-20.4C34 9 28 3 20 3z"
                fill="#E3F2FF"
                stroke="#2584EB"
                strokeWidth="2.4"
              />
              <path
                d="M12.5 17.5c2-4.5 5-6 7.5-6s5.6 1.6 7.5 6"
                fill="none"
                stroke="#2584EB"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity=".75"
              />
              <path
                d="M15.5 20.5c1.3-2.6 2.8-3.4 4.5-3.4s3.2.8 4.5 3.4"
                fill="none"
                stroke="#2584EB"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity=".55"
              />
              <circle cx="20" cy="23.5" r="2.2" fill="#2584EB" />
            </svg>
            <div>
              <div className="text-[19px] font-bold tracking-tight text-white leading-tight">
                Map<span className="text-[#00C2E8]">Well</span>
              </div>
              <div className="text-[9.5px] font-bold tracking-wider text-[#8EA9C7] uppercase">
                COMMUNITY HEALTH MAPPING
              </div>
            </div>
          </div>

          {/* Form Main Area */}
          <form onSubmit={handleSubmit} className="my-5 space-y-3.5">
            <div>
              <h1 className="text-2xl sm:text-[27px] font-bold tracking-tight text-white leading-tight">
                Sign in to MapWell
              </h1>
              <p className="text-[13px] text-[#8EA9C7] mt-1">
                Use your health department account to open your workspace.
              </p>
            </div>

            {generalError && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[12px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{generalError}</span>
              </div>
            )}

            {resetMessage && (
              <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-200 text-[12px] flex items-start gap-2">
                <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <span>{resetMessage}</span>
              </div>
            )}

            {/* Work Email */}
            <div>
              <label className="block text-[12px] font-semibold text-[#CBD5E1] mb-1">
                Work email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#64748B] absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="email"
                  id="login-email"
                  placeholder="you@health.gov"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError('');
                  }}
                  className={`w-full h-[44px] pl-10 pr-4 rounded-xl border bg-white text-[13.5px] font-medium text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all ${
                    emailError
                      ? 'border-rose-500 ring-2 ring-rose-500/20'
                      : 'border-[#CBD5E1] focus:border-[#00C2E8] focus:ring-2 focus:ring-[#00C2E8]/20'
                  }`}
                />
              </div>
              {emailError && (
                <p className="text-[11px] text-rose-400 mt-1 font-medium">{emailError}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-semibold text-[#CBD5E1]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-[12px] font-semibold text-[#00C2E8] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#64748B] absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  className={`w-full h-[44px] pl-10 pr-10 rounded-xl border bg-white text-[13.5px] font-medium text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all ${
                    passwordError
                      ? 'border-rose-500 ring-2 ring-rose-500/20'
                      : 'border-[#CBD5E1] focus:border-[#00C2E8] focus:ring-2 focus:ring-[#00C2E8]/20'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-2.5 w-7 h-7 rounded-lg text-[#64748B] hover:text-[#0F172A] flex items-center justify-center transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordError && (
                <p className="text-[11px] text-rose-400 mt-1 font-medium">{passwordError}</p>
              )}
            </div>

            {/* Sign in as (Roles) */}
            <div>
              <label className="block text-[12px] font-semibold text-[#CBD5E1] mb-1.5">
                Sign in as
              </label>
              <div className="flex flex-col sm:grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Sign in role">
                {ROLES.map((r) => {
                  const isSelected = selectedRole === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedRole(r.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'border-2 border-[#00C2E8] bg-[#F0F9FF] shadow-sm'
                          : 'border border-[#CBD5E1] bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className={`text-[12px] font-bold leading-tight ${isSelected ? 'text-[#0284C7]' : 'text-[#0F172A]'}`}>
                        {r.title}
                      </div>
                      <div className="text-[10px] text-[#64748B] mt-0.5 leading-tight">
                        {r.org}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Keep me signed in */}
            <div className="flex items-center pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-400 text-[#00C2E8] accent-[#00C2E8] cursor-pointer"
                />
                <span className="text-[12.5px] text-[#CBD5E1]">
                  Keep me signed in
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isGoogleSubmitting}
              className="w-full h-[46px] rounded-xl bg-gradient-to-r from-[#00C2E8] to-[#0284C7] hover:brightness-105 text-white font-bold text-[14px] flex items-center justify-center gap-2 shadow-[0_8px_20px_-6px_rgba(0,194,232,0.6)] transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer"
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
            <div className="relative flex items-center justify-center my-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#233954]" />
              </div>
              <span className="relative bg-[#15273C] px-3 text-[11.5px] text-[#8EA9C7]">
                or
              </span>
            </div>

            {/* SSO / Google button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting || isGoogleSubmitting}
              className="w-full h-[44px] rounded-xl border border-[#CBD5E1] bg-white hover:bg-slate-50 text-[#0F172A] font-semibold text-[13px] flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer shadow-xs"
            >
              {isGoogleSubmitting ? (
                <div className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-[#00C2E8] animate-spin" />
              ) : (
                <LinkIcon className="w-4 h-4 text-[#00C2E8]" />
              )}
              <span>Continue with single sign-on</span>
            </button>
            
          </form>

          {/* Card Footer */}
          <div className="pt-3 border-t border-[#233954] flex items-center justify-between text-[11.5px] text-[#64748B]">
            <span>Synthetic demo environment</span>
            <span>Need access? Contact your data administrator</span>
          </div>
        </section>

        {/* ================= Right Column: Showcase Map ================= */}
        <section className="hidden lg:flex flex-col justify-between relative rounded-[24px] overflow-hidden border border-[#D6E9F8] bg-gradient-to-br from-[#E7F3FF] via-[#E2F0FE] to-[#D7EBFC] p-8 shadow-sm min-h-[580px]">
          
          {/* Header Copy */}
          <div className="relative z-10 max-w-xl">
            <h2 className="text-2xl xl:text-[26px] font-bold tracking-tight text-[#102A45] leading-snug">
              Census tract insight for every community you serve
            </h2>
            <p className="text-[13px] text-[#486581] mt-2 max-w-lg leading-relaxed">
              Map social determinants, disease incidence and program use, find underserved neighborhoods, and turn findings into assessments.
            </p>
          </div>

          {/* Real US County Choropleth Map View */}
          <div className="absolute inset-0 pt-16 pb-12 px-6 flex items-center justify-center">
            <LoginShowcaseMap />
          </div>

          {/* Floating County Card (Top Right matching screenshot) */}
          <div className="absolute right-8 top-28 z-20 bg-white/95 rounded-2xl p-4 shadow-[0_12px_28px_-6px_rgba(16,42,69,0.14)] border border-[#E2E8F0] w-[190px] backdrop-blur-sm">
            <div className="w-8 h-8 rounded-xl bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center mb-2 shadow-xs">
              <Grid className="w-4 h-4" />
            </div>
            <div className="text-[13px] font-bold text-[#0F172A] leading-tight">
              Warren County, IL
            </div>
            <div className="text-[10.5px] text-[#64748B] mt-0.5">
              Census tracts analyzed
            </div>
            <div className="text-[22px] font-black text-[#0F172A] tracking-tight mt-1 num">
              17
            </div>
          </div>

          {/* Floating Vulnerability Scale (Bottom Left matching screenshot) */}
          <div className="absolute left-8 bottom-20 z-20 bg-white/95 rounded-2xl p-3.5 shadow-[0_12px_28px_-6px_rgba(16,42,69,0.14)] border border-[#E2E8F0] w-[210px] backdrop-blur-sm">
            <div className="text-[12px] font-bold text-[#0F172A]">Community vulnerability</div>
            <div className="text-[10px] text-[#64748B] mb-2">Vulnerability index</div>
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-[#CBE5FE] via-[#3B82F6] to-[#172554]" />
            <div className="flex justify-between text-[9.5px] text-[#64748B] mt-1 font-semibold">
              <span>0.01</span>
              <span>Counties</span>
              <span>0.99</span>
            </div>
          </div>

          {/* Capability Pills (Bottom row matching screenshot) */}
          <div className="relative z-10 flex flex-wrap gap-2 pt-4">
            {['Health map', 'Tract explorer', 'Disparities', 'Needs assessments', 'Reports'].map((pill) => (
              <span
                key={pill}
                className="px-3.5 py-1.5 rounded-full text-[11.5px] font-semibold bg-white/90 border border-[#D6E9F8] text-[#2A4365] shadow-xs backdrop-blur-sm"
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
