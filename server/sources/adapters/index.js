import * as adzuna from "./adzuna.js";
import * as muse from "./muse.js";
import * as remotive from "./remotive.js";
import * as jobicy from "./jobicy.js";
import * as arbeitnow from "./arbeitnow.js";
import * as remoteok from "./remoteok.js";
import * as greenhouse from "./greenhouse.js";
import * as lever from "./lever.js";
import * as ashby from "./ashby.js";
import * as routinelog from "./routinelog.js";
import * as jackandjill from "./jackandjill.js";

export const adapters = [adzuna, muse, remotive, jobicy, arbeitnow, remoteok, greenhouse, lever, ashby, routinelog, jackandjill];

export const { fetchGreenhouseBoard } = greenhouse;
export const { fetchLeverBoard } = lever;
export const { fetchAshbyBoard } = ashby;

export const REMOTEOK_ATTRIBUTION = remoteok.ATTRIBUTION;
export const describeJackAndJill = jackandjill.describe;
export const describeRoutine = routinelog.describe;
