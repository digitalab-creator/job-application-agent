const test = require('node:test');
const assert = require('node:assert/strict');
const salary = require('../lib/salaryBenchmark');

test('detectSalaryCurrency uses USD for US office locations', () => {
  assert.equal(salary.detectSalaryCurrency('San Francisco, CA', 'Remote'), 'USD');
  assert.equal(salary.detectSalaryCurrency('Tel Aviv', 'Hybrid'), 'ILS');
  assert.equal(salary.detectSalaryCurrency('Not specified', 'Remote'), 'ILS');
});

test('parseListedSalary normalizes ILS monthly ranges', () => {
  const parsed = salary.parseListedSalary('25,000–30,000 NIS');
  assert.equal(parsed.currency, 'ILS');
  assert.equal(parsed.min, 25000);
  assert.equal(parsed.max, 30000);
  assert.equal(salary.formatParsedSalary(parsed), '25,000–30,000 ILS/mo');
});

test('estimateSalaryRange uses benchmarks for Israel jobs without listed salary', () => {
  const result = salary.estimateSalaryRange({
    role: 'Senior PPC Manager',
    category: 'Growth Marketing',
    location: 'Tel Aviv',
    work_mode: 'Hybrid',
    salary: 'Not listed',
    opportunity_type: 'Job',
  });
  assert.match(result.display, /ILS\/mo$/);
  assert.match(result.display, /^\d{2},\d{3}–\d{2},\d{3} ILS\/mo$/);
  assert.ok(result.source.includes('AllJobs'));
});

test('estimateSalaryRange uses USD annual bands for US remote roles', () => {
  const result = salary.estimateSalaryRange({
    role: 'AI Engineer',
    category: 'Applied AI',
    location: 'Remote - US',
    work_mode: 'Remote',
    salary: '',
    opportunity_type: 'Job',
  });
  assert.match(result.display, /USD\/yr$/);
  assert.ok(result.source.length > 0);
});

test('estimateSalaryRange uses hourly freelance benchmarks in ILS', () => {
  const result = salary.estimateSalaryRange({
    role: 'Meta ads consultant',
    category: 'Growth Marketing',
    location: 'Israel',
    work_mode: 'Remote',
    salary: 'Not listed',
    opportunity_type: 'Freelance',
  });
  assert.match(result.display, /ILS\/hr$/);
  assert.ok(result.source.includes('freelancer'));
});

test('estimateSalaryRange formats listed salary instead of benchmarking', () => {
  const result = salary.estimateSalaryRange({
    role: 'Growth Lead',
    category: 'Growth Marketing',
    location: 'Herzliya',
    work_mode: 'Office',
    salary: '28,000-32,000 NIS/month',
    opportunity_type: 'Job',
  });
  assert.equal(result.display, '25,000–30,000 ILS/mo');
  assert.equal(result.source, 'Listed on posting');
});

test('ILS estimate ranges are at most 5,000 ILS wide', () => {
  const cases = [
    {
      role: 'Junior Marketing Analyst',
      category: 'Growth Marketing',
      location: 'Ramat Gan',
      work_mode: 'Office',
    },
    {
      role: 'Senior PPC Manager',
      category: 'Growth Marketing',
      location: 'Tel Aviv',
      work_mode: 'Hybrid',
    },
    {
      role: 'AI Solutions Engineer',
      category: 'Applied AI',
      location: 'Herzliya',
      work_mode: 'Hybrid',
    },
  ];

  cases.forEach((candidate) => {
    const result = salary.estimateSalaryRange(Object.assign({
      salary: 'Not listed',
      opportunity_type: 'Job',
    }, candidate));
    const [minPart, maxPart] = result.display.replace(' ILS/mo', '').split('–');
    const min = Number(minPart.replace(/,/g, ''));
    const max = Number(maxPart.replace(/,/g, ''));
    assert.equal(max - min, salary.MAX_RANGE_WIDTH_ILS, result.display);
    assert.equal(min % salary.SALARY_BAND_ILS, 0);
    assert.equal(max % salary.SALARY_BAND_ILS, 0);
  });
});

test('evaluateSalaryFloor rejects jobs when listed or estimated max is below 23k ILS/mo', () => {
  const lowListed = salary.evaluateSalaryFloor('18,000 NIS/month', '');
  assert.equal(lowListed.ok, false);
  assert.equal(lowListed.maxMonthlyIls, 18000);

  const lowEstimate = salary.evaluateSalaryFloor('Not listed', '15,000–20,000 ILS/mo');
  assert.equal(lowEstimate.ok, false);
  assert.equal(lowEstimate.maxMonthlyIls, 20000);

  const passes = salary.evaluateSalaryFloor('Not listed', '25,000–30,000 ILS/mo');
  assert.equal(passes.ok, true);
});

test('evaluateSalaryFloor converts USD annual salaries to ILS monthly equivalent', () => {
  const lowUsd = salary.evaluateSalaryFloor('Not listed', '65,000–70,000 USD/yr');
  assert.equal(lowUsd.ok, false);
  assert.ok(lowUsd.maxMonthlyIls < salary.MIN_MONTHLY_SALARY_ILS);

  const highUsd = salary.evaluateSalaryFloor('Not listed', '90,000–95,000 USD/yr');
  assert.equal(highUsd.ok, true);
  assert.ok(highUsd.maxMonthlyIls >= salary.MIN_MONTHLY_SALARY_ILS);
});

test('listed salary takes priority over estimate for floor check', () => {
  const result = salary.evaluateSalaryFloor('22,000 NIS', '30,000–35,000 ILS/mo');
  assert.equal(result.ok, false);
  assert.equal(result.maxMonthlyIls, 22000);
});
