/**
 * SignalGrid Local Brain: bounded, in-memory job state machine.
 *
 * Every mutation requires an explicit worker (where applicable) and the
 * state version the caller last observed. Persist snapshot() transactionally
 * in a separate coordinator: this class does NOT provide cross-process locking,
 * secure attestation, or durable storage on its own.
 */

const VALID_STATES = new Set(['PENDING', 'ASSIGNED', 'INTERRUPTED', 'COMPLETED']);

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function validVersion(value, label = 'State version') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function successfulVerification(details) {
  return details !== null && typeof details === 'object' && !Array.isArray(details) &&
    typeof details.command === 'string' && details.command.trim().length > 0 &&
    details.exitCode === 0 && Number.isSafeInteger(details.passed) && details.passed > 0;
}

function freshVerification(checkpoint, workerId) {
  return checkpoint?.type === 'verification' && checkpoint.workerId === workerId &&
    successfulVerification(checkpoint.details);
}

function jsonCopy(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError('Checkpoint details must be JSON-serializable');
  }
  if (serialized === undefined) {
    throw new TypeError('Checkpoint details must be JSON-serializable');
  }
  return JSON.parse(serialized);
}

export class JobState {
  constructor(jobId, repository, workerId, startingCommit) {
    this.jobId = nonEmptyString(jobId, 'Job ID');
    this.repository = nonEmptyString(repository, 'Repository');
    this.assignedWorkerId = nonEmptyString(workerId, 'Assigned worker ID');
    this.startingCommit = nonEmptyString(startingCommit, 'Starting commit');
    this.status = 'PENDING';
    this.stateVersion = 1;
    this.checkpoints = [];
  }

  getVersion() {
    return this.stateVersion;
  }

  #expectVersion(expectedVersion) {
    validVersion(expectedVersion, 'Expected state version');
    if (expectedVersion !== this.stateVersion) {
      throw new Error(`Stale state version: expected ${expectedVersion}, current ${this.stateVersion}`);
    }
    if (this.stateVersion >= Number.MAX_SAFE_INTEGER) {
      throw new Error('State version overflow');
    }
  }

  #expectStatus(required) {
    if (this.status !== required) {
      throw new Error(`Invalid transition: expected ${required}, current ${this.status}`);
    }
  }

  #expectOwner(workerId) {
    nonEmptyString(workerId, 'Acting worker ID');
    if (workerId !== this.assignedWorkerId) {
      throw new Error(`Competing worker claim: ${workerId} is not the assigned worker`);
    }
  }

  #record(type, details, workerId) {
    const checkpoint = {
      id: this.checkpoints.length + 1,
      type,
      workerId,
      details: jsonCopy(details),
      timestamp: new Date().toISOString(),
    };
    this.checkpoints.push(checkpoint);
    return jsonCopy(checkpoint);
  }

  claim(workerId, expectedVersion) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('PENDING');
    this.#expectOwner(workerId);
    this.status = 'ASSIGNED';
    this.stateVersion++;
    return this.snapshot();
  }

  checkpoint(data, expectedVersion, workerId) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('ASSIGNED');
    this.#expectOwner(workerId);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Checkpoint must be an object');
    }
    const type = nonEmptyString(data.type, 'Checkpoint type');
    if (!Object.hasOwn(data, 'details')) {
      throw new TypeError('Checkpoint details are required');
    }
    if (type === 'verification') {
      if (!successfulVerification(data.details)) {
        throw new Error('Verification requires a command, exitCode 0, and a positive passed count');
      }
    }
    const item = this.#record(type, data.details, workerId);
    this.stateVersion++;
    return { stateVersion: this.stateVersion, newCheckpoint: item };
  }

  handoff(newWorkerId, expectedVersion, actingWorkerId) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('ASSIGNED');
    this.#expectOwner(actingWorkerId);
    nonEmptyString(newWorkerId, 'New worker ID');
    if (newWorkerId === this.assignedWorkerId) {
      throw new Error('Duplicate handoff: new worker is already assigned');
    }
    const before = this.assignedWorkerId;
    this.#record('handoff', { from: before, to: newWorkerId }, actingWorkerId);
    this.assignedWorkerId = newWorkerId;
    this.stateVersion++;
    return this.snapshot();
  }

  interrupt(reason, expectedVersion, actingWorkerId) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('ASSIGNED');
    this.#expectOwner(actingWorkerId);
    nonEmptyString(reason, 'Interruption reason');
    this.#record('interruption', { reason }, actingWorkerId);
    this.status = 'INTERRUPTED';
    this.stateVersion++;
    return this.snapshot();
  }

  resume(newWorkerId, expectedVersion) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('INTERRUPTED');
    nonEmptyString(newWorkerId, 'Resuming worker ID');
    const before = this.assignedWorkerId;
    this.#record('resume', { from: before, to: newWorkerId }, newWorkerId);
    this.assignedWorkerId = newWorkerId;
    this.status = 'ASSIGNED';
    this.stateVersion++;
    return this.snapshot();
  }

  complete(isVerified, expectedVersion, actingWorkerId) {
    this.#expectVersion(expectedVersion);
    this.#expectStatus('ASSIGNED');
    this.#expectOwner(actingWorkerId);
    if (isVerified !== true) {
      throw new Error('Cannot complete unverified work');
    }
    const evidence = this.checkpoints.at(-1);
    if (!freshVerification(evidence, actingWorkerId)) {
      throw new Error('Cannot complete unverified work: fresh successful verification checkpoint required');
    }
    this.status = 'COMPLETED';
    this.stateVersion++;
    return this.snapshot();
  }

  failIncomplete() {
    throw new Error('Cannot complete unverified work');
  }

  snapshot() {
    return jsonCopy({
      jobId: this.jobId,
      repository: this.repository,
      assignedWorkerId: this.assignedWorkerId,
      startingCommit: this.startingCommit,
      status: this.status,
      stateVersion: this.stateVersion,
      checkpoints: this.checkpoints,
    });
  }

  static restore(savedState) {
    if (!savedState || typeof savedState !== 'object' || Array.isArray(savedState)) {
      throw new TypeError('Saved state must be an object');
    }
    const saved = jsonCopy(savedState);
    const restored = new JobState(
      saved.jobId, saved.repository, saved.assignedWorkerId, saved.startingCommit,
    );
    if (!VALID_STATES.has(saved.status)) {
      throw new Error('Invalid saved status');
    }
    validVersion(saved.stateVersion);
    if (!Array.isArray(saved.checkpoints)) {
      throw new TypeError('Saved checkpoints must be an array');
    }
    for (const [index, entry] of saved.checkpoints.entries()) {
      if (!entry || typeof entry !== 'object' || entry.id !== index + 1 ||
          typeof entry.type !== 'string' || !entry.type.trim() ||
          typeof entry.timestamp !== 'string' ||
          typeof entry.workerId !== 'string' ||
          !Object.hasOwn(entry, 'details')) {
        throw new Error(`Invalid saved checkpoint at index ${index}`);
      }
      if (entry.type === 'verification' && !successfulVerification(entry.details)) {
        throw new Error(`Invalid saved verification checkpoint at index ${index}`);
      }
    }
    if (saved.stateVersion < saved.checkpoints.length + 1) {
      throw new Error('Saved state version is inconsistent with checkpoints');
    }
    if (saved.status === 'COMPLETED' &&
        !freshVerification(saved.checkpoints.at(-1), saved.assignedWorkerId)) {
      throw new Error('Completed saved state requires fresh successful verification by the assigned worker');
    }
    restored.status = saved.status;
    restored.stateVersion = saved.stateVersion;
    restored.checkpoints = saved.checkpoints;
    return restored;
  }
}

export default JobState;
