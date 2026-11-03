'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Icon } from '@/components/Icons';
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
  { id: 'admin', title: 'Data Administrator', org: 'Health Data Team', avatar: 'DA' }
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
      setResetMessage(`In a live deployment, a reset link would be emailed to ${trimmed}. For this demo environment, any valid email and 8+ char password will sign in.`);
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

    let hasError = false;
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setEmailError('Please enter your work email address');
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError('Please enter a valid email address (e.g. name@health.gov)');
      hasError = true;
    }

    if (!password) {
      setPasswordError('Please enter your password');
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError('Password must contain at least 8 characters');
      hasError = true;
    }

    if (hasError) return;

    setIsSubmitting(true);
    try {
      const roleObj = ROLES.find((r) => r.id === selectedRole) || ROLES[0];
      await login(trimmedEmail, password, roleObj.id, rememberMe);
      router.replace('/');
    } catch (err: any) {
      setGeneralError(err.message || 'Unable to sign in. Please verify your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleSubmitting(true);
    try {
      const roleObj = ROLES.find((r) => r.id === selectedRole) || ROLES[0];
      await loginWithGoogle({ role: roleObj.id }, roleObj.id, rememberMe);
      router.replace('/');
    } catch (err: any) {
      setGeneralError('Single sign-on authentication failed. Please try standard sign in.');
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div id="login">
      {/* Left Column: Sign-in Card */}
      <section className="lg-card" style={{ background: '#24354D', color: '#FFFFFF' }}>
        {/* Brand header */}
        <div className="lg-brand">
          <svg viewBox="0 0 40 40" aria-hidden="true">
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
          <span>
            <b>
              Map<span>Well</span>
            </b>
            <small>COMMUNITY HEALTH MAPPING</small>
          </span>
        </div>

        {/* Main form */}
        <form className="lg-main" id="lg-form" onSubmit={handleSubmit} noValidate>
          <h1>Sign in to MapWell</h1>
          <p>Use your health department account to open your workspace.</p>

          {/* Reset / General Message */}
          {resetMessage && (
            <div
              className="lg-note"
              style={{
                marginBottom: '14px',
                marginTop: '0',
                background: '#EAF4FF',
                borderColor: '#B9D6F0',
                color: '#1A55B8'
              }}
            >
              <span>ℹ</span>
              <span>{resetMessage}</span>
            </div>
          )}

          {generalError && (
            <div
              className="lg-note"
              style={{
                marginBottom: '14px',
                marginTop: '0',
                background: '#FDECEE',
                borderColor: '#F7C6CC',
                color: '#C72248'
              }}
            >
              <span>⚠</span>
              <span>{generalError}</span>
            </div>
          )}

          {/* Email input */}
          <label className="lg-f">
            <span className="lbl">Work email</span>
            <span className={`lg-in ${emailError ? 'bad' : ''}`} id="lg-e-wrap">
              <Icon name="mail" />
              <input
                id="lg-email"
                type="email"
                autoComplete="username"
                placeholder="you@health.gov"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError('');
                }}
              />
            </span>
            <span className="lg-err" id="lg-e-err">
              {emailError}
            </span>
          </label>

          {/* Password input */}
          <label className="lg-f">
            <span className="lbl">
              Password
              <button type="button" className="lg-link" id="lg-forgot" onClick={handleForgotPassword}>
                Forgot password?
              </button>
            </span>
            <span className={`lg-in ${passwordError ? 'bad' : ''}`} id="lg-p-wrap">
              <Icon name="lock" />
              <input
                id="lg-pass"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError('');
                }}
              />
              <button
                type="button"
                className="lg-eye"
                id="lg-eye"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                <Icon name="eye" />
              </button>
            </span>
            <span className="lg-err" id="lg-p-err">
              {passwordError}
            </span>
          </label>

          {/* Role Radiogroup */}
          <div className="lg-f" role="radiogroup" aria-label="Sign in as">
            <span className="lbl">Sign in as</span>
            <div className="lg-roles">
              {ROLES.map((r) => {
                const isOn = selectedRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`lg-role ${isOn ? 'on' : ''}`}
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => setSelectedRole(r.id)}
                  >
                    {r.title}
                    <small>{r.org}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Keep me signed in */}
          <div className="lg-row">
            <label>
              <input
                type="checkbox"
                id="lg-rem"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Keep me signed in
            </label>
          </div>

          {/* Submit Button */}
          <button className="lg-btn" id="lg-go" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <span className="lg-spin" /> : <span>Sign in</span>}
          </button>

          {/* Divider */}
          <div className="lg-or">or</div>

          {/* SSO Button */}
          <button
            type="button"
            className="lg-sso"
            id="lg-sso"
            onClick={handleGoogleSignIn}
            disabled={isGoogleSubmitting}
          >
            {isGoogleSubmitting ? (
              <span className="lg-spin" style={{ borderColor: 'rgba(0,144,194,0.3)', borderTopColor: 'var(--cyan)' }} />
            ) : (
              <>
                <Icon name="link" />
                <span>Continue with single sign-on</span>
              </>
            )}
          </button>

          {/* Demo Note */}
          <div className="lg-note">
            <span>●</span>
            <span>
              Demo sign-in. Any valid email and a password of 8 or more characters will work. Nothing is sent anywhere.
            </span>
          </div>
        </form>

        {/* Footer */}
        <div className="lg-foot">
          <span>Synthetic demo environment</span>
          <span>Need access? Contact your data administrator</span>
        </div>
      </section>

      {/* Right Column: Hero Showcase */}
      <section className="lg-side" aria-hidden="true">
        <div className="lg-copy">
          <h2>Census tract insight for every community you serve</h2>
          <p>
            Map social determinants, disease incidence and program use, find underserved neighborhoods, and turn findings
            into assessments.
          </p>
        </div>

        <div id="lg-map" style={{ position: 'absolute', inset: '90px 40px 120px' }}>
          <LoginShowcaseMap />
        </div>

        <div className="lg-float" style={{ position: 'absolute', right: '40px', top: '150px', width: '210px', zIndex: 5 }}>
          <span className="m-ico">
            <Icon name="grid" />
          </span>
          <b>King County, WA</b>
          <span className="note">Census tracts analyzed</span>
          <div className="v num">398</div>
        </div>

        <div className="lg-float" style={{ position: 'absolute', left: '40px', bottom: '96px', width: '230px', zIndex: 5 }}>
          <b>Community vulnerability</b>
          <div
            className="legend"
            style={{ padding: '8px 0 0', minWidth: 0, background: 'none', border: 0, boxShadow: 'none' }}
          >
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>Vulnerability index</div>
            <div
              style={{
                height: '7px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, #CDE7FB 0%, #8CC6F4 25%, #4C9BEA 50%, #2462C9 75%, #163A7E 100%)'
              }}
            />
            <div
              className="ends"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '4px',
                fontSize: '10px',
                color: 'var(--faint)'
              }}
            >
              <span>0.01</span>
              <span>Counties</span>
              <span>0.99</span>
            </div>
          </div>
        </div>

        <div className="lg-caps">
          <span>Health map</span>
          <span>Tract explorer</span>
          <span>Disparities</span>
          <span>Needs assessments</span>
          <span>Reports</span>
        </div>
      </section>
    </div>
  );
}
