// @flow

import window from './window';
import { extend } from './util';

import type { Callback } from '../types/callback';
import type { Cancelable } from '../types/cancelable';

/**
 * The type of a resource.
 * @private
 * @readonly
 * @enum {string}
 */
const ResourceType = {
    Unknown: 'Unknown',
    Style: 'Style',
    Source: 'Source',
    Tile: 'Tile',
    Glyphs: 'Glyphs',
    SpriteImage: 'SpriteImage',
    SpriteJSON: 'SpriteJSON',
    Image: 'Image'
};
export { ResourceType };

if (typeof Object.freeze == 'function') {
    Object.freeze(ResourceType);
}

/**
 * A `RequestParameters` object to be returned from Map.options.transformRequest callbacks.
 * @typedef {Object} RequestParameters
 * @property {string} url The URL to be requested.
 * @property {Object} headers The headers to be sent with the request.
 * @property {string} credentials `'same-origin'|'include'` Use 'include' to send cookies with cross-origin requests.
 */
export type RequestParameters = {
    url: string,
    headers?: Object,
    method?: 'GET' | 'POST' | 'PUT',
    body?: string,
    type?: 'string' | 'json' | 'arraybuffer',
    credentials?: 'same-origin' | 'include',
    collectResourceTiming?: boolean
};

export type ResponseCallback<T> = (error: ?Error, data: ?T, cacheControl: ?string, expires: ?string) => void;

class AJAXError extends Error {
    status: number;
    url: string;
    constructor(message: string, status: number, url: string) {
        super(message);
        this.status = status;
        this.url = url;

        // work around for https://github.com/Rich-Harris/buble/issues/40
        this.name = this.constructor.name;
        this.message = message;
    }

    toString() {
        return `${this.name}: ${this.message} (${this.status}): ${this.url}`;
    }
}

function makeRequest(requestParameters: RequestParameters, callback: ResponseCallback<any>): Cancelable {
    const xhr: XMLHttpRequest = new window.XMLHttpRequest();

    xhr.open(requestParameters.method || 'GET', requestParameters.url, true);
    if (requestParameters.type === 'arraybuffer') {
        xhr.responseType = 'arraybuffer';
    }
    for (const k in requestParameters.headers) {
        xhr.setRequestHeader(k, requestParameters.headers[k]);
    }
    if (requestParameters.type === 'json') {
        xhr.setRequestHeader('Accept', 'application/json');
    }
    xhr.withCredentials = requestParameters.credentials === 'include';
    xhr.onerror = () => {
        callback(new Error(xhr.statusText));
    };
    xhr.onload = () => {
        if (((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) && xhr.response !== null) {
            let data: mixed = xhr.response;
            if (requestParameters.type === 'json') {
                // We're manually parsing JSON here to get better error messages.
                try {
                    data = JSON.parse(xhr.response);
                } catch (err) {
                    return callback(err);
                }
            }
            callback(null, data, xhr.getResponseHeader('Cache-Control'), xhr.getResponseHeader('Expires'));
        } else {
            if (xhr.status === 401 && requestParameters.url.match(/mapbox.com/)) {
                callback(new AJAXError(`${xhr.statusText}: you may have provided an invalid Mapbox access token. See https://www.mapbox.com/api-documentation/#access-tokens`, xhr.status, requestParameters.url));
            } else {
                callback(new AJAXError(xhr.statusText, xhr.status, requestParameters.url));
            }
        }
    };
    xhr.send(requestParameters.body);
    return { cancel: () => xhr.abort() };
}

export const getJSON = function(requestParameters: RequestParameters, callback: ResponseCallback<Object>): Cancelable {
    return makeRequest(extend(requestParameters, { type: 'json' }), callback);
};

export const getArrayBuffer = function(requestParameters: RequestParameters, callback: ResponseCallback<ArrayBuffer>): Cancelable {
    return makeRequest(extend(requestParameters, { type: 'arraybuffer' }), callback);
};

export const postData = function(requestParameters: RequestParameters, callback: ResponseCallback<string>): Cancelable {
    return makeRequest(extend(requestParameters, { method: 'POST' }), callback);
};

function sameOrigin(url) {
    const a: HTMLAnchorElement = window.document.createElement('a');
    a.href = url;
    return a.protocol === window.document.location.protocol && a.host === window.document.location.host;
}

const transparentPngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';

export const getImage = function(requestParameters: RequestParameters, callback: Callback<HTMLImageElement>): Cancelable {
    // request the image with XHR to work around caching issues
    // see https://github.com/mapbox/mapbox-gl-js/issues/1470
    return getArrayBuffer(requestParameters, (err: ?Error, data: ?ArrayBuffer, cacheControl: ?string, expires: ?string) => {
        if (err) {
            callback(err);
        } else if (data) {
            const img: HTMLImageElement = new window.Image();
            const URL = window.URL || window.webkitURL;
            img.onload = () => {
                callback(null, img);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => callback(new Error('Could not load image. Please make sure to use a supported image type such as PNG or JPEG. Note that SVGs are not supported.'));
            const blob: Blob = new window.Blob([new Uint8Array(data)], { type: 'image/png' });
            (img: any).cacheControl = cacheControl;
            (img: any).expires = expires;
            img.src = data.byteLength ? URL.createObjectURL(blob) : transparentPngUrl;
        }
    });
};

export const getVideo = function(urls: Array<string>, callback: Callback<HTMLVideoElement>): Cancelable {
    const video: HTMLVideoElement = window.document.createElement('video');
    video.muted = true;
    video.onloadstart = function() {
        callback(null, video);
    };
    for (let i = 0; i < urls.length; i++) {
        const s: HTMLSourceElement = window.document.createElement('source');
        if (!sameOrigin(urls[i])) {
            video.crossOrigin = 'Anonymous';
        }
        s.src = urls[i];
        video.appendChild(s);
    }
    return { cancel: () => {} };
};
