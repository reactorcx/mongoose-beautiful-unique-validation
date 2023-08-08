'use strict';

const mongoose = require('mongoose');

const errorRegex = /index: (.+) dup key:/;

/** @type <Map<string, mongoose.mongo.BSON.Documen>> */
const INDEXES_CACHE = new Map();

const MONGO_ERRORS = new Set([
	'MongoServerError',
	'BulkWriteError',
	// mongoose 5.x
	'MongoError',
]);

/**
 * Check if the given error is a unique error.
 *
 * @param {Object} err Error to test.
 * @return {bool} True if and only if it is an unique error.
 */
function isUniqueError(err) {
	return (
		err &&
		MONGO_ERRORS.has(err.name) &&
		(err.code === 11000 || err.code === 11001)
	);
}

/**
 * Search for the value matching a path in dotted notation
 * inside an object.
 *
 * @example
 * - getValueByPath({a: {b: 2}}, 'a.b') -> 2
 * - getValueByPath({}, 'a.b') -> undefined
 * @param {object} obj Nested object to search.
 * @param {string} path Path of the value to search for.
 * @return {any} Matching value, or undefined if none.
 */
function getValueByPath(obj, path) {
	const segments = path.split('.');
	let result = obj;

	for (
		let i = 0;
		i < segments.length && result !== null && result !== undefined;
		++i
	) {
		result = result[segments[i]];
	}

	return result;
}

/**
 * Recursively collect all messages inside a schema tree and
 * change string values to `true`.
 *
 * @param {object} tree Schema tree to update and collect from.
 * @return {object} Map of collected messages.
 */
function collectMessages(tree) {
	let result = {};

	for (let key in tree) {
		if (!has(tree, key)) continue;
		if (typeof tree[key] !== 'object' || tree[key] === null) continue;

		if (typeof tree[key].unique === 'string') {
			// Schema property that has a custom
			// unique message
			result[key] = tree[key].unique;
			tree[key].unique = true;
		} else {
			// Nested schema
			let tarnget = tree[key];

			if (tarnget instanceof mongoose.Schema) {
				tarnget = tarnget.tree;
			}

			let subtree = collectMessages(tarnget);

			for (let subkey in subtree) {
				if (has(subtree, subkey)) {
					result[key + '.' + subkey] = subtree[subkey];
				}
			}
		}
	}

	return result;
}

/**
 * Retrieve index information using collection#indexInformation
 * or previously cached data.
 *
 * @param {mongoose.Collection} collection Mongoose collection.
 *
 * Resolved with index information data.
 * @return {Promise<mongoose.mongo.BSON.Documen>}
 */
async function getIndexes(collection) {
	const cacheKey = `${collection.dbName}_${collection.name}`;

	if (INDEXES_CACHE.has(cacheKey)) {
		return INDEXES_CACHE.get(cacheKey);
	}

	const indexes = await collection.indexInformation();

	INDEXES_CACHE.set(cacheKey, indexes);

	return indexes;
}

/**
 * Beautify an E11000 or 11001 (unique constraint fail) Mongo error
 * by turning it into a validation error
 *
 * @param {mongoose.mongo.MongoError} err Error to process
 * @param {mongoose.Collection} collection Mongoose collection.
 * @param {object} values Hashmap containing data about duplicated values
 * @param {object} messages Map fields to unique error messages
 * @param {string} defaultMessage Default message formatter string
 * @return {Promise<mongoose.Error.ValidationError>} Beautified error message
 */
function beautify(error, collection, values, messages, defaultMessage) {
	// Try to recover the list of duplicated fields
	let onSuberrors = global.Promise.resolve({});

	// Extract the failed duplicate index's name from the
	// from the error message (with a hacky regex)
	let matches = errorRegex.exec(error.message);

	if (matches) {
		let indexName = matches[1].split('$').pop();

		// Retrieve that index's list of fields
		onSuberrors = getIndexes(collection).then(function (indexes) {
			let suberrors = {};

			// Create a suberror per duplicated field
			if (indexName in indexes) {
				indexes[indexName].forEach(function (field) {
					let path = field[0];
					let props = {
						type: 'unique',
						path: path,
						value: getValueByPath(values, path),
						message:
							typeof messages[path] === 'string'
								? messages[path]
								: defaultMessage,
					};

					suberrors[path] = new mongoose.Error.ValidatorError(props);
				});
			}

			return suberrors;
		});
	}

	return onSuberrors.then(function (suberrors) {
		let beautifiedError = new mongoose.Error.ValidationError();

		beautifiedError.errors = suberrors;
		return beautifiedError;
	});
}

module.exports = function (schema, options) {
	options = options || {};

	if (!options.defaultMessage) {
		options.defaultMessage = 'Path `{PATH}` ({VALUE}) is not unique.';
	}

	// Fetch error messages defined in the "unique" field,
	// store them for later use and replace them with true
	let tree = schema.tree;
	let messages = collectMessages(tree);

	schema._indexes.forEach(function (index) {
		if (index[0] && index[1] && index[1].unique) {
			Object.keys(index[0]).forEach(function (indexKey) {
				messages[indexKey] = index[1].unique;
			});

			index[1].unique = true;
		}
	});

	// Post hook that gets called after any save or update
	// operation and that filters unique errors
	let postHook = function (error, _, next) {
		// Mongoose ≥5 does no longer pass the document as the
		// second argument of 'update' hooks, so we use this instead
		let doc = this;

		// If the next() function is missing, this might be
		// a sign that we are using an outdated Mongoose
		if (typeof next !== 'function') {
			throw new Error(
				'mongoose-beautiful-unique-validation error: ' +
					'The hook was called incorrectly. Double check that ' +
					'you are using mongoose@>=4.5.0; if you need to use ' +
					'an outdated Mongoose version, please install this module ' +
					'in version 4.0.0',
			);
		}

		if (isUniqueError(error)) {
			// Beautify unicity constraint failure errors
			let collection, values;

			if (this.constructor.name == 'Query') {
				collection = this.model.collection;
				values = this._update;

				if ('$set' in values) {
					values = Object.assign({}, values, values.$set);
					delete values.$set;
				}
			} else {
				collection = doc.collection;
				values = doc;
			}

			beautify(error, collection, values, messages, options.defaultMessage)
				.then(next)
				.catch(function (beautifyError) {
					setTimeout(function () {
						throw new Error(
							'mongoose-beautiful-unique-validation error: ' +
								beautifyError.stack,
						);
					});
				});
		} else {
			// Pass over other errors
			next(error);
		}
	};

	schema.post('save', postHook);
	schema.post('updateOne', postHook);
    	schema.post('updateMany', postHook);
	schema.post('findOneAndUpdate', postHook);
};

/**
 * @param {object} obj
 * @param {string} key
 * @return {key in obj}
 */
function has(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}