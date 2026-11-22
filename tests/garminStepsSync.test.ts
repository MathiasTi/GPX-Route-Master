import {
  extractGarminDailiesList,
  parseGarminDailyRecord,
  fetchGarminJsonWithFallback
} from '../utils/garminPersonalApi';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

export async function runGarminStepsSyncTests(): Promise<boolean> {
  console.log('👟 Running Garmin Personal API Steps & Dailies Sync Test Suite...');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  await test('Parses official v2/dailysummaries nested payload (movement.steps.value, heartRate, stress, calories)', () => {
    const payload = {
      data: [
        {
          calendarDate: '2026-11-21',
          movement: {
            steps: { value: 16946 },
            distance: { value: 13240 }
          },
          calories: {
            total: 2680,
            active: 890,
            bmr: 1790
          },
          heartRate: {
            restingValue: 48
          },
          stress: {
            avgLevel: 27
          }
        }
      ]
    };

    const list = extractGarminDailiesList(payload);
    assert(list.length === 1, `Expected 1 daily summary item, got ${list.length}`);

    const parsed = parseGarminDailyRecord(list[0], 'auto');
    assert(parsed !== null, 'Parsed record must not be null');
    assert(parsed!.date === '2026-11-21', `Expected 2026-11-21, got ${parsed!.date}`);
    assert(parsed!.steps === 16946, `Expected 16946 steps, got ${parsed!.steps}`);
    assert(parsed!.distanceKm === 13.24, `Expected 13.24 km, got ${parsed!.distanceKm}`);
    assert(parsed!.calories === 2680, `Expected 2680 kcal, got ${parsed!.calories}`);
    assert(parsed!.rhr === 48, `Expected 48 RHR, got ${parsed!.rhr}`);
    assert(parsed!.avgStress === 27, `Expected 27 stress, got ${parsed!.avgStress}`);
  });

  await test('Parses stats/steps/daily array payload (totalSteps, totalDistance, stepGoal)', () => {
    const payload = [
      {
        calendarDate: '2026-11-20',
        totalSteps: 11250,
        totalDistance: 8950.5,
        stepGoal: 7320
      },
      {
        calendarDate: '2026-11-21',
        totalSteps: 16946,
        totalDistance: 13410.0,
        stepGoal: 7320
      }
    ];

    const list = extractGarminDailiesList(payload);
    assert(list.length === 2, `Expected 2 step records, got ${list.length}`);

    const day2 = parseGarminDailyRecord(list[1], 'steps');
    assert(day2 !== null && day2.steps === 16946, `Expected 16946 steps, got ${day2?.steps}`);
    assert(day2!.distanceKm === 13.41, `Expected 13.41 km, got ${day2!.distanceKm}`);
    assert(day2!.calories === undefined, 'Must not fabricate calories when absent from stats/steps/daily');
  });

  await test('Parses allMetrics.metricsMap without clobbering earlier metrics', () => {
    const payload = {
      allMetrics: {
        metricsMap: {
          WELLNESS_TOTAL_STEPS: [{ calendarDate: '2026-11-21', value: 16946 }],
          WELLNESS_RESTING_HEART_RATE: [{ calendarDate: '2026-11-21', value: 50 }],
          WELLNESS_AVERAGE_STRESS: [{ calendarDate: '2026-11-21', value: 24 }],
          WELLNESS_TOTAL_CALORIES: [{ calendarDate: '2026-11-21', value: 2540 }]
        }
      }
    };

    const list = extractGarminDailiesList(payload);
    assert(list.length === 1, 'Expected 1 merged day from metricsMap');
    const parsed = parseGarminDailyRecord(list[0], 'auto');
    assert(parsed!.steps === 16946, `Expected 16946 steps, got ${parsed!.steps}`);
    assert(parsed!.rhr === 50, `Expected 50 RHR, got ${parsed!.rhr}`);
    assert(parsed!.avgStress === 24, `Expected 24 stress, got ${parsed!.avgStress}`);
    assert(parsed!.calories === 2540, `Expected 2540 kcal, got ${parsed!.calories}`);
  });

  await test('Parses flat single-day usersummary payload (activeKilocalories + bmrKilocalories)', () => {
    const payload = {
      calendarDate: '2026-11-21',
      totalSteps: 16946,
      totalDistanceMeters: 13100,
      activeKilocalories: 720,
      bmrKilocalories: 1810,
      restingHeartRate: 49
    };

    const list = extractGarminDailiesList(payload);
    assert(list.length === 1, 'Single day summary should wrap into 1-element array');
    const parsed = parseGarminDailyRecord(list[0], 'auto');
    assert(parsed!.steps === 16946, `Expected 16946 steps, got ${parsed!.steps}`);
    assert(parsed!.calories === 2530, `Expected 2530 combined kcal, got ${parsed!.calories}`);
    assert(parsed!.distanceKm === 13.1, `Expected 13.1 km, got ${parsed!.distanceKm}`);
  });

  await test('fetchGarminJsonWithFallback continues past HTTP 400 and 403 to succeed on valid steps endpoint', async () => {
    const calledPaths: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const pathname = new URL(url).pathname;
      calledPaths.push(pathname);

      if (pathname.includes('/v2/dailysummaries')) {
        return new Response('Bad Request', { status: 400 });
      }
      if (pathname.includes('/wellness/daily')) {
        return new Response('Forbidden', { status: 403 });
      }
      if (pathname.includes('/stats/steps/daily')) {
        return new Response(
          JSON.stringify([{ calendarDate: '2026-11-21', totalSteps: 16946, totalDistance: 13200 }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const result = await fetchGarminJsonWithFallback(
      [
        'https://personal.connectapi.garmin.com/usersummary-service/v2/dailysummaries?startDate=2026-11-21&endDate=2026-11-21',
        'https://personal.connectapi.garmin.com/userstats-service/wellness/daily/2026-11-21?untilDate=2026-11-21',
        'https://personal.connectapi.garmin.com/usersummary-service/stats/steps/daily/2026-11-21/2026-11-21'
      ],
      'dummy-token',
      { allowNotFoundAsEmpty: true, allowErrorsAsEmpty: true, fetchImpl: mockFetch }
    );

    assert(calledPaths.length === 3, `Expected all 3 URLs attempted, got ${calledPaths.length}`);
    assert(Array.isArray(result.data) && result.data.length === 1, 'Expected valid steps array from 3rd endpoint');
    assert(result.data[0].totalSteps === 16946, `Expected 16946 steps, got ${result.data[0].totalSteps}`);
    assert(result.attempts.length === 3, 'Expected 3 recorded diagnostic attempts');
    assert(result.attempts[0].status === 400 && result.attempts[1].status === 403 && result.attempts[2].status === 200, 'Attempt status codes must match');
  });

  await test('fetchGarminJsonWithFallback returns empty data with attempts instead of throwing on 400/403 when allowErrorsAsEmpty is true', async () => {
    const mockFetch = (async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
    const result = await fetchGarminJsonWithFallback(
      [
        'https://personal.connectapi.garmin.com/usersummary-service/v2/dailysummaries?startDate=2026-11-21&endDate=2026-11-21',
        'https://personal.connectapi.garmin.com/usersummary-service/stats/steps/daily/2026-11-21/2026-11-21'
      ],
      'dummy-token',
      { allowNotFoundAsEmpty: true, allowErrorsAsEmpty: true, fetchImpl: mockFetch }
    );
    assert(Array.isArray(result.data) && result.data.length === 0, 'Must return empty array instead of throwing');
    assert(result.attempts.length === 2 && result.attempts.every((a) => a.status === 403), 'Must record 403 attempts for diagnostics');
  });

  await test('fetchGarminJsonWithFallback still fails fast on HTTP 401 Unauthorized', async () => {
    let calls = 0;
    const mockFetch = (async () => {
      calls++;
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    let threw401 = false;
    try {
      await fetchGarminJsonWithFallback(
        [
          'https://personal.connectapi.garmin.com/usersummary-service/v2/dailysummaries?startDate=2026-11-21&endDate=2026-11-21',
          'https://personal.connectapi.garmin.com/usersummary-service/stats/steps/daily/2026-11-21/2026-11-21'
        ],
        'expired-token',
        { allowNotFoundAsEmpty: true, allowErrorsAsEmpty: true, fetchImpl: mockFetch }
      );
    } catch (e: any) {
      threw401 = Boolean(e?.message?.includes('401'));
    }
    assert(threw401, 'HTTP 401 must throw immediately even with allowErrorsAsEmpty');
    assert(calls === 1, `Expected 1 call before 401 abort, got ${calls}`);
  });

  console.log(`👟 Garmin Steps Sync Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
