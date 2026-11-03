'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSession } from '@/context/SessionContext';
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
  const { activeCounty } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('analyst');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [shake, setShake] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  // Animated count-up for census tracts analyzed HUD card
  const tractCount = 398;
  const countyLabel = activeCounty?.name
    ? `${activeCounty.name}, ${activeCounty.stateAbbr}`
    : 'King County, WA';

  const [displayedCount, setDisplayedCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const duration = 1200;
    const startTime = performance.now();
    let frameId: number;

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplayedCount(Math.round(tractCount * ease));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [tractCount]);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user, router]);

  const handleForgotPassword = () => {
    const trimmed = email.trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setResetMessage(
        `In a live deployment, a reset link would be emailed to ${trimmed}. This demo does not send email.`
      );
    } else {
      setResetMessage('Enter your work email above, then choose Forgot password again. This demo does not send email.');
    }
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setPasswordError('');
    setGeneralError('');

    let hasError = false;
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setEmailError('Enter your work email.');
      hasError = true;
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      setEmailError('Enter a valid email address.');
      hasError = true;
    }

    if (!password) {
      setPasswordError('Enter your password.');
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError('Passwords are at least 8 characters.');
      hasError = true;
    }

    if (hasError) {
      triggerShake();
      return;
    }

    setIsSubmitting(true);
    try {
      const roleObj = ROLES.find((r) => r.id === selectedRole) || ROLES[0];
      const res = await login(trimmedEmail, password, roleObj.id, rememberMe);
      if (!res.success) {
        setGeneralError(res.error || 'Failed to sign in. Please verify your credentials.');
        triggerShake();
      } else {
        router.replace('/');
      }
    } catch (err: any) {
      setGeneralError(err.message || 'Unable to sign in. Please verify your credentials.');
      triggerShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleSubmitting(true);
    try {
      const roleObj = ROLES.find((r) => r.id === selectedRole) || ROLES[0];
      const res = await loginWithGoogle({ role: roleObj.id }, roleObj.id, rememberMe);
      if (!res.success) {
        setGeneralError(res.error || 'Single sign-on authentication failed. Please try standard sign in.');
      } else {
        router.replace('/');
      }
    } catch (err: any) {
      setGeneralError('Single sign-on authentication failed. Please try standard sign in.');
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div id="login">
      {/* Left Column: Sign-in Card */}
      <section className="lg-card">
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
        <form className={`lg-main ${shake ? 'lg-shake' : ''}`} id="lg-form" onSubmit={handleSubmit} noValidate>
          <h1>Sign in to MapWell</h1>
          <p>Use your health department account to open your workspace.</p>

          {/* Reset / General Message */}
          <div id="lg-reset">
            {resetMessage && <div className="lg-reset">{resetMessage}</div>}
            {generalError && (
              <div
                className="lg-reset"
                style={{
                  background: '#FFF1F2',
                  borderColor: '#FECDD3',
                  color: '#BE123C',
                  marginBottom: '14px'
                }}
              >
                {generalError}
              </div>
            )}
          </div>

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
                    data-r={r.id}
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
            {isSubmitting ? (
              <>
                <span className="lg-spin" />
                <span>Signing in</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
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
              <>
                <span className="lg-spin" style={{ borderColor: 'rgba(0,144,194,0.3)', borderTopColor: 'var(--cyan)' }} />
                <span>Connecting SSO...</span>
              </>
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

      {/* Right Column: Hero Showcase Map */}
      <LoginShowcaseMap countyName={countyLabel} tractCount={displayedCount || 398} />
    </div>
  );
}
