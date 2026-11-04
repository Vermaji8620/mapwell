'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { useAuth } from '@/context/AuthContext';
import { useSession } from '@/context/SessionContext';
import { LoginShowcaseMap } from '@/components/LoginShowcaseMap';

interface RoleOption {
  id: string;
  title: string;
  org: string;
  avatar: string;
}

const LOGIN_ROLES: RoleOption[] = [
  { id: 'analyst', title: 'Public Health Analyst', org: 'County Health Department', avatar: 'PA' },
  { id: 'manager', title: 'Program Manager', org: 'City Health Department', avatar: 'PM' },
  { id: 'admin', title: 'Data Administrator', org: 'Health Data Team', avatar: 'DA' },
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
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const cardRef = useRef<HTMLElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Animated count-up for census tracts analyzed HUD card
  const tractCount = 398;
  const countyLabel = activeCounty?.name
    ? `${activeCounty.name}, ${activeCounty.stateAbbr}`
    : 'King County, WA';

  const [displayedCount, setDisplayedCount] = useState(0);

  useEffect(() => {
    const obj = { val: 0 };
    const tween = gsap.to(obj, {
      val: tractCount,
      duration: 1.5,
      ease: 'power3.out',
      onUpdate: () => {
        setDisplayedCount(Math.round(obj.val));
      },
    });
    return () => {
      tween.kill();
    };
  }, [tractCount]);

  // Entrance animation for form fields
  useEffect(() => {
    if (!cardRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from('.lg-main > *', {
        y: 14,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: 'power3.out',
        clearProps: 'opacity,transform',
      });
    }, cardRef);

    // Auto focus email input on mount
    const timer = setTimeout(() => {
      emailInputRef.current?.focus({ preventScroll: true });
    }, 300);

    return () => {
      ctx.revert();
      clearTimeout(timer);
    };
  }, []);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user, router]);

  const handleForgotPassword = () => {
    const em = email.trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      setResetMessage(
        `In a live deployment, a reset link would be emailed to <b>${em}</b>. This demo does not send email.`
      );
    } else {
      setResetMessage(
        'Enter your work email above, then choose Forgot password again. This demo does not send email.'
      );
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

    let ok = true;
    const em = email.trim();

    if (!em) {
      setEmailError('Enter your work email.');
      ok = false;
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      setEmailError('Enter a valid email address.');
      ok = false;
    }

    if (!password) {
      setPasswordError('Enter your password.');
      ok = false;
    } else if (password.length < 8) {
      setPasswordError('Passwords are at least 8 characters.');
      ok = false;
    }

    if (!ok) {
      triggerShake();
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await login(em, password, selectedRole, rememberMe);
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
      const res = await loginWithGoogle({ role: selectedRole }, selectedRole, rememberMe);
      if (!res.success) {
        setGeneralError('Single sign-on is not connected in this demo. Use email and password.');
        triggerShake();
      } else {
        router.replace('/');
      }
    } catch (err: any) {
      setGeneralError('Single sign-on is not connected in this demo. Use email and password.');
      triggerShake();
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div id="login">
      {/* Left Column: Sign-in Card */}
      <section ref={cardRef} className="lg-card">
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
        <form
          className={`lg-main ${shake ? 'lg-shake' : ''}`}
          id="lg-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <h1>Sign in to MapWell</h1>
          <p>Use your health department account to open your workspace.</p>

          <div id="lg-reset">
            {resetMessage && (
              <div
                className="lg-reset"
                dangerouslySetInnerHTML={{ __html: resetMessage }}
              />
            )}
            {generalError && (
              <div
                className="lg-reset"
                style={{
                  background: '#FFF1F2',
                  borderColor: '#FECDD3',
                  color: '#BE123C',
                  marginBottom: '14px',
                }}
              >
                {generalError}
              </div>
            )}
          </div>

          <label className="lg-f">
            <span className="lbl">Work email</span>
            <span className={`lg-in ${emailError ? 'bad' : ''}`} id="lg-e-wrap">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m4 7 8 6 8-6" />
              </svg>
              <input
                ref={emailInputRef}
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

          <label className="lg-f">
            <span className="lbl">
              Password
              <button
                type="button"
                className="lg-link"
                id="lg-forgot"
                onClick={handleForgotPassword}
              >
                Forgot password?
              </button>
            </span>
            <span className={`lg-in ${passwordError ? 'bad' : ''}`} id="lg-p-wrap">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="10" width="14" height="10" rx="2.5" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
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
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
            <span className="lg-err" id="lg-p-err">
              {passwordError}
            </span>
          </label>

          <div className="lg-f" role="radiogroup" aria-label="Sign in as">
            <span className="lbl">Sign in as</span>
            <div className="lg-roles">
              {LOGIN_ROLES.map((r) => {
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

          <div className="lg-or">or</div>

          <button
            type="button"
            className="lg-sso"
            id="lg-sso"
            onClick={handleGoogleSignIn}
            disabled={isGoogleSubmitting}
          >
            {isGoogleSubmitting ? (
              <>
                <span className="lg-spin" />
                <span>Signing in</span>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </svg>
                <span>Continue with single sign-on</span>
              </>
            )}
          </button>

          <div className="lg-note">
            <span>●</span>
            <span>
              Demo sign-in. Any valid email and a password of 8 or more characters will work.
              Nothing is sent anywhere.
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
