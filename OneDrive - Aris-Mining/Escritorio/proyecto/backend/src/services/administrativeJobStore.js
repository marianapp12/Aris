import { randomUUID } from 'crypto';

/** @typedef {{ status: 'pending'|'running'|'completed'|'failed', createdAt: string, result?: object, error?: string, log?: string }} AdministrativeJob */

const jobs = new Map();

export const administrativeJobStore = {
  /**
   * @returns {string} jobId
   */
  createJob() {
    const id = randomUUID();
    jobs.set(id, {
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return id;
  },

  /**
   * @param {string} id
   */
  setRunning(id) {
    const j = jobs.get(id);
    if (j) j.status = 'running';
  },

  /**
   * @param {string} id
   * @param {object} result
   * @param {string} [log]
   */
  completeJob(id, result, log) {
    const j = jobs.get(id);
    if (!j) return;
    j.status = 'completed';
    j.result = result;
    if (log) j.log = log;
  },

  /**
   * @param {string} id
   * @param {string} message
   * @param {string} [log]
   */
  failJob(id, message, log) {
    const j = jobs.get(id);
    if (!j) return;
    j.status = 'failed';
    j.error = message;
    if (log) j.log = log;
  },

  /**
   * @param {string} id
   * @returns {AdministrativeJob | undefined}
   */
  get(id) {
    return jobs.get(id);
  },
};
