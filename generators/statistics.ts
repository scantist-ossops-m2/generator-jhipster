/**
 * Copyright 2013-2024 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see https://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import os from 'os';
import { randomUUID } from 'crypto';
import Conf from 'conf';
import { osLocaleSync } from 'os-locale';
import axios from 'axios';
import Insight from 'insight';
import { packageJson as packagejs } from '../lib/index.js';

const DO_NOT_ASK_LIMIT = 100;

const DEFAULT_JHIPSTER_ONLINE_URL = 'https://start.jhipster.tech';

type InsightConfig = {
  clientId: string;
  doNotAskCounter: number;
  isLinked: boolean;
};

class Statistics {
  config: Conf<InsightConfig>;
  jhipsterOnlineUrl: string;
  statisticsAPIPath: string;
  clientId: string;
  doNotAskCounter: number;
  optOut: any;
  isLinked: any;
  noInsight: string | boolean | undefined;
  forceInsight: boolean;
  insight: any;
  axiosClient: any;
  axiosProxyClient: any;
  statisticsAPI: string | undefined;

  constructor() {
    this.config = new Conf({
      configName: 'jhipster-insight',
      projectName: packagejs.name,
      defaults: {
        clientId: randomUUID().toString(),
        doNotAskCounter: 0,
        isLinked: false,
      },
    });
    this.jhipsterOnlineUrl = process.env.JHIPSTER_ONLINE_URL || DEFAULT_JHIPSTER_ONLINE_URL;
    this.statisticsAPIPath = `${this.jhipsterOnlineUrl}/api`;
    this.clientId = this.config.get('clientId');
    this.doNotAskCounter = this.config.get('doNotAskCounter');
    this.optOut = this.config.get('optOut');
    this.isLinked = this.config.get('isLinked');
    this.noInsight = process.argv.includes('--no-insight') || process.env.CI === 'true' || process.env.MOCHA_WORKER_ID;
    this.forceInsight = process.argv.includes('--force-insight');
    this.configInsight();

    if (this.noInsight) {
      this.noInsightConfig();
    } else {
      this.configProxy();
    }
  }

  configInsight(trackingCode = 'UA-46075199-2', packageName = packagejs.name, packageVersion = packagejs.version) {
    const insight = new Insight({
      trackingCode,
      packageName,
      packageVersion,
    });

    insight.trackWithEvent = (category, action) => {
      insight.track(category, action);
      insight.trackEvent({
        category,
        action,
        label: `${category} ${action}`,
        value: 1,
      });
    };
    if (this.optOut !== undefined) {
      insight.optOut = this.optOut;
    }
    this.insight = insight;
  }

  noInsightConfig() {
    this.optOut = true;
  }

  postRequest(url, data, force = false) {
    if (!this.optOut || force) {
      this.axiosClient
        .post(url, data)
        .then(
          () => {},
          () => {
            if (this.axiosProxyClient) {
              this.axiosProxyClient
                .post(url, data)
                .then(() => {})
                .catch(() => {});
            }
          },
        )
        .catch(() => {});
    }
  }

  postWithProxy(url, data) {
    return this.axiosProxyClient.post(url, data);
  }

  configProxy() {
    this.axiosClient = axios.create({
      baseURL: this.statisticsAPIPath,
    });

    const npmHttpsProxy = process.env.npm_config_https_proxy || process.env.npm_config_proxy;
    const npmHttpProxy = process.env.npm_config_http_proxy || process.env.npm_config_proxy;
    const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const proxySettings = npmHttpsProxy || npmHttpProxy || envProxy;
    if (proxySettings) {
      const splitted = proxySettings.split(':');
      this.axiosProxyClient = axios.create({
        baseURL: this.statisticsAPI,
        proxy: { host: splitted[0], port: Number(splitted[1]) },
      });
    }
  }

  shouldWeAskForOptIn() {
    if (this.noInsight || this.forceInsight) {
      return false;
    }
    if (this.optOut) {
      this.doNotAskCounter++;
      this.config.set('doNotAskCounter', this.doNotAskCounter % DO_NOT_ASK_LIMIT);
    }

    return this.optOut === undefined || (this.optOut && this.doNotAskCounter >= DO_NOT_ASK_LIMIT);
  }

  setConfig(key, value) {
    this.config.set(key, value);
    this[key] = value;
  }

  deleteConfig(key) {
    this.config.delete(key);
  }

  setOptOutStatus(status) {
    this.setConfig('optOut', status);
  }

  setLinkedStatus(status) {
    this.setConfig('isLinked', status);
  }

  sendYoRc(yorc, isARegeneration, generatorVersion) {
    if (this.noInsight) return;
    this.postRequest(
      '/s/entry',
      {
        'generator-jhipster': yorc,
        'generator-id': this.clientId,
        'generator-version': generatorVersion,
        'git-provider': 'local',
        'node-version': process.version,
        os: `${os.platform()}:${os.release()}`,
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        cores: os.cpus().length,
        memory: os.totalmem(),
        'user-language': osLocaleSync(),
        isARegeneration,
      },
      this.forceInsight,
    );

    this.insight.trackWithEvent('generator', 'app');
    this.insight.track('app/applicationType', yorc.applicationType);
    this.insight.track('app/testFrameworks', yorc.testFrameworks);
    this.insight.track('app/clientPackageManager', yorc.clientPackageManager);
  }

  sendSubGenEvent(source, type, event?) {
    if (this.noInsight) return;
    const strEvent = event === '' ? event : JSON.stringify(event);
    this.postRequest(`/s/event/${this.clientId}`, { source, type, event: strEvent }, this.forceInsight);
    this.insight.trackWithEvent(source, type);
    if (event) {
      this.sendInsightSubGenEvents(type, event);
    }
  }

  /**
   * Recursively send events that are contained in an Object.
   * ie:
   *      const a = { b: 'value', c: { d: 'another value' } };
   *      sendInsightSubGenEvents('foo/bar', a);
   *  will send :
   *      this.insight.track('foo/bar/b', 'value');
   *      this.insight.track('foo/bar/b/c/d', 'another value');
   *
   * @param {string} prefix insight event prefix
   * @param {any} eventObject events that you want to send
   */
  sendInsightSubGenEvents(prefix, eventObject) {
    if (this.noInsight || eventObject === null || eventObject === undefined) return;
    if (typeof eventObject === 'object') {
      Object.keys(eventObject).forEach(key => {
        const value = eventObject[key];
        if (typeof eventObject[key] === 'object') {
          this.sendInsightSubGenEvents(`${prefix}/${key}`, value);
        } else {
          this.insight.track(`${prefix}/${key}`, value);
        }
      });
    } else {
      this.insight.track(prefix, eventObject);
    }
  }

  sendEntityStats(fields, relationships, pagination, dto, service, fluentMethods) {
    if (this.noInsight) return;
    this.postRequest(
      `/s/entity/${this.clientId}`,
      {
        fields,
        relationships,
        pagination,
        dto,
        service,
        fluentMethods,
      },
      this.forceInsight,
    );
  }
}

export default new Statistics();
