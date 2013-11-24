'use strict';

var assert = require('assert'),
    api = require('../api'),
    Q = require('q'),
    port = api.port + 1;

function doneCallback (done) {
    return function () { done(); };
}

function doneErrback (done) {
    return function (error) { done(error); };
}

describe('http imposter', function () {

    describe('GET /imposters/:id', function () {
        it('should return 404 if imposter has not been created', function (done) {
            api.get('/imposters/3535').done(function (response) {
                assert.strictEqual(response.statusCode, 404);
                done();
            }, doneErrback(done));
        });
    });

    describe('DELETE /imposters/:id should shutdown server at that port', function () {
        it('should shutdown server at that port', function (done) {
            api.post('/imposters', { protocol: 'http', port: port }).then(function (response) {
                return api.del(response.getLinkFor('self'));
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'Delete failed');

                return api.post('/imposters', { protocol: 'http', port: port });
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 201, 'Delete did not free up port');

                return api.del(response.getLinkFor('self'));
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should return a 200 even if the server does not exist', function (done) {
            api.del('/imposters/9999').then(function (response) {
                assert.strictEqual(response.statusCode, 200);
                return Q(true);
            }).done(doneCallback(done), doneErrback(done));
        });
    });

    describe('GET /imposters/:id/requests', function () {
        it('should provide access to all requests', function (done) {
            var requestsPath;

            api.post('/imposters', { protocol: 'http', port: 6565 }).then(function (response) {
                requestsPath = response.getLinkFor('requests');
                return api.get('/first', 6565);
            }).then(function () {
                return api.get('/second', 6565);
            }).then(function () {
                return api.get(requestsPath);
            }).then(function (response) {
                var requests = response.body.requests.map(function (request) {
                    return request.path;
                });
                assert.deepEqual(requests, ['/first', '/second']);

                return api.del('/imposters/6565');
            }).done(doneCallback(done), doneErrback(done));
        });
    });

    describe('POST /imposters/:id/stubs', function () {
        it('should return stubbed response', function (done) {
            api.post('/imposters', { protocol: 'http', port: 5555 }).then(function (response) {
                var stubsPath = response.getLinkFor('stubs'),
                    stubBody = {
                        predicates: { path: { is: '/test' }},
                        responses: [{
                            is: {
                                statusCode: 400,
                                headers: { 'X-Test': 'test header' },
                                body: 'test body'
                            }
                        }]
                    };

                return api.post(stubsPath, stubBody);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200);

                return api.get('/test', 5555);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 400);
                assert.strictEqual(response.body, 'test body');
                assert.strictEqual(response.headers['x-test'], 'test header');

                return api.del('/imposters/5555');
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should allow a sequence of stubs as a circular buffer', function (done) {
            api.post('/imposters', { protocol: 'http', port: 6565 }).then(function (response) {
                var stubsPath = response.getLinkFor('stubs'),
                    stubBody = {
                        predicates: { path: { is: '/test' }},
                        responses: [{ is: { statusCode: 400 }}, { is: { statusCode: 405 }}]
                    };

                return api.post(stubsPath, stubBody);
            }).then(function () {
                return api.get('/test', 6565);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 400);

                return api.get('/test', 6565);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 405);

                return api.get('/test', 6565);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 400);

                return api.get('/test', 6565);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 405);

                return api.del('/imposters/6565');
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should only return stubbed response if matches complex predicate', function (done) {
            var spec = {
                    path: '/test',
                    port: 1515,
                    method: 'POST',
                    headers: {
                        'X-One': 'Test',
                        'X-Two': 'Test',
                        'Content-Type': 'text/plain'
                    }
                };

            api.post('/imposters', { protocol: 'http', port: 1515 }).then(function (response) {
                var stubsPath = response.getLinkFor('stubs'),
                    stubBody = {
                        path: '/test',
                        responses: [{ is: { statusCode: 400 }}],
                        predicates: {
                            path: { is: '/test' },
                            method: { is: 'POST' },
                            headers: {
                                exists: { 'X-One': true, 'X-Two': true },
                                is: { 'X-Two': 'Test' },
                                not: { exists: { 'X-Three': true }}
                            },
                            body: {
                                startsWith: 'T',
                                contains: 'ES',
                                endsWith: 'T',
                                matches: '^TEST$',
                                is: 'TEST',
                                exists: true
                            }
                        }
                    };

                return api.post(stubsPath, stubBody);
            }).then(function () {
                var options = api.merge(spec, { path: '/' });
                return api.responseFor(options, 'TEST');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'should not have matched; wrong path');

                var options = api.merge(spec, { method: 'PUT' });
                return api.responseFor(options, 'TEST');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'should not have matched; wrong method');

                var options = api.merge(spec, {});
                delete options.headers['X-One'];
                return api.responseFor(options, 'TEST');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'should not have matched; missing header');

                var options = api.merge(spec, { headers: { 'X-Two': 'Testing' }});
                return api.responseFor(options, 'TEST');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'should not have matched; wrong value for header');

                return api.responseFor(api.merge(spec, {}), 'TESTing');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, 'should not have matched; wrong value for body');

                return api.responseFor(api.merge(spec, {}), 'TEST');
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 400, 'should have matched');

                return api.del('/imposters/1515');
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should allow javascript predicate for matching', function (done) {
            api.post('/imposters', { protocol: 'http', port: 5555 }).then(function (response) {
                var stubsPath = response.getLinkFor('stubs'),
                    stubBody = {
                        predicates: {
                            path: { inject: "function (path) { return path === '/test'; }" },
                            method: { inject: "function (method) { return method === 'POST'; }"},
                                // note the lower-case key!!!
                            headers: { inject: "function (headers) { return headers['x-test'] === 'test header'; }"},
                            body: { inject: "function (body) { return body === 'BODY'; }"},
                            request: { inject: "function (request) { return request.path === '/test'; }"}
                        },
                        responses: [{ is: { body: 'MATCHED' } }]
                    };

                return api.post(stubsPath, stubBody);
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

                var spec = {
                    path: '/test',
                    port: 5555,
                    method: 'POST',
                    headers: {
                        'X-Test': 'test header',
                        'Content-Type': 'text/plain'
                    }
                };
                return api.responseFor(spec, 'BODY');
            }).then(function (response) {
                assert.strictEqual(response.body, 'MATCHED');

                return api.del('/imposters/5555');
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should allow proxy stubs', function (done) {
            api.post('/imposters', { protocol: 'http', port: 4545 }).then(function () {
                return api.post('/imposters/4545/stubs', { responses: [{ is: { body: 'PROXIED' } }] });
            }).then(function () {
                return api.post('/imposters', { protocol: 'http', port: 5555 });
            }).then(function () {
                return api.post('/imposters/5555/stubs', { responses: [{ proxy: 'http://localhost:4545' }] });
            }).then(function (response) {
                assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

                return api.get('/', 5555);
            }).then(function (response) {
                assert.strictEqual(response.body, 'PROXIED');

                return api.del('/imposters/5555');
            }).then(function () {
                return api.del('/imposters/4545');
            }).done(doneCallback(done), doneErrback(done));
        });

        it('should allow proxyOnce behavior');
        it('should allow javascript injection');
    });
});
