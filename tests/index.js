'use strict';

const test = require('tape');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const version = require('mongoose/package.json').version;

// Pass our Promise implementation
// (see http://mongoosejs.com/docs/promises.html)
mongoose.Promise = global.Promise;

// Connect to a random database
var mongouri =
	'mongodb://localhost/mongoose-buv-' + crypto.randomBytes(8).toString('hex');

console.log('Using mongoose@' + version);

const Schema = mongoose.Schema;
const beautifulValidation = require('../');

mongoose.plugin(beautifulValidation);

test('database connection', (t) => {
	console.log('Connecting to ' + mongouri + '...');

	// Pass the useMongoClient flag to mongoose versions that need it
	const options = {};

	mongoose
		.connect(mongouri, options)
		.then(function () {
			console.log('Connected!');

			// clean up the test database and disconnect after all tests
			test.onFinish(function () {
				mongoose.connection.db
					.dropDatabase()
					.then(function () {
						return mongoose.disconnect();
					})
					.catch(function (err) {
						console.error(
							'Could not clean up or disconnect from the ' + 'test database:',
							err,
						);
					});
			});

			t.end();
		})
		.catch(function (err) {
			console.error('Could not connect to the test database.');
			t.end(err);
		});
});

/**
 * Assert that the given object is a correct validation error.
 *
 * @param {Object} t Tape assertion object
 * @param {Object} err Object to test.
 * @param {Object} dups Map from fields that are duplicated to their value.
 * @param {Object} messages Map from fields to the message that should be
 * associated to the error object resulting from their duplicated value.
 */
function assertUniqueError(t, err, dups, messages) {
	t.equal(
		err.name,
		'ValidationError',
		'the thrown error should be of type ValidationError',
	);

	let missing = Object.keys(dups).filter(function (key) {
		let suberr = err.errors[key];

		if (!err.errors[key]) {
			return true;
		}

		t.equal(
			suberr.name,
			'ValidatorError',
			'each sub-error should be of name ValidatorError',
		);
		t.equal(suberr.kind, 'unique', 'each sub-error\'s kind should be "unique"');
		t.equal(
			suberr.message,
			messages[key],
			'each sub-error should carry over the custom message',
		);

		// with buffer values, only compare the inner "buffer" property
		t.equal(
			suberr.properties.value.toString(),
			dups[key].toString(),
			'the sub-error should contain the duplicated value',
		);

		t.equal(
			suberr.properties.path,
			key,
			"the sub-error should contain the duplicated value's path",
		);

		t.equal(
			suberr.properties.type,
			'unique',
			'the sub-error\'s type should be "unique"',
		);

		return false;
	});

	t.equal(missing.length, 0, 'should report a sub-error per duplicated field');

	t.equal(
		Object.keys(err.errors).length,
		Object.keys(dups).length,
		'should only report a sub-error per duplicated field',
	);
}

test('should report duplicates', function (t) {
	let DuplicateSchema = new Schema({
		name: {
			type: String,
			unique: true,
		},
		age: {
			type: Number,
		},
		address: {
			type: String,
			unique: true,
		},
	});

	let Duplicate = mongoose.model('Duplicate', DuplicateSchema);

	Duplicate.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new Duplicate({
			name: 'John Doe',
			age: 13,
			address: '123 Fake St.',
		})
			.save()
			.then(
				function () {
					return new Duplicate({
						name: 'Jane Doe',
						age: 13,
						address: '123 Fake St.',
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ address: '123 Fake St.' },
						{ address: 'Path `address` (123 Fake St.) is not unique.' },
					);

					t.end();
				},
			);
	});
});

test('should report duplicates with Model.create()', function (t) {
	let CreateSchema = new Schema({
		name: {
			type: String,
			unique: true,
		},
		age: {
			type: Number,
		},
		address: {
			type: String,
			unique: true,
		},
	});

	let Create = mongoose.model('Create', CreateSchema);

	Create.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		Create.create({
			name: 'John Doe',
			age: 13,
			address: '123 Fake St.',
		})
			.then(
				function () {
					return Create.create({
						name: 'Jane Doe',
						age: 13,
						address: '123 Fake St.',
					});
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ address: '123 Fake St.' },
						{ address: 'Path `address` (123 Fake St.) is not unique.' },
					);

					t.end();
				},
			);
	});
});

test('should report duplicates with Model.findOneAndUpd()', function (t) {
	let FoauSchema = new Schema({
		address: {
			type: String,
			unique: true,
		},
	});

	let Foau = mongoose.model('Foau', FoauSchema);

	Foau.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		// Create two non-conflicting instances and save them
		global.Promise.all([
			new Foau({
				address: '123 Fake St.',
			}).save(),
			new Foau({
				address: '321 Fake St.',
			}).save(),
		])
			.then(function () {
				// Update one of the instances to conflict with the first one
				Foau.findOneAndUpdate(
					{
						address: '321 Fake St.',
					},
					{
						address: '123 Fake St.',
					},
				)
					.exec()
					.then(
						function () {
							t.fail('should not update duplicate successfully');
							t.end();
						},
						function (err) {
							assertUniqueError(
								t,
								err,
								{ address: '123 Fake St.' },
								{ address: 'Path `address` (123 Fake St.) is not unique.' },
							);

							t.end();
						},
					);
			})
			.catch(function (err) {
				t.error(err, 'should save original instance successfully');
				t.end();
			});
	});
});

test('should report duplicates with Model.update()', function (t) {
	let UpdateSchema = new Schema({
		address: {
			type: String,
			unique: true,
		},
	});

	let Update = mongoose.model('Update', UpdateSchema);

	Update.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		// Create two non-conflicting instances and save them
		let upd1 = new Update({
			address: '123 Fake St.',
		});

		let upd2 = new Update({
			address: '321 Fake St.',
		});

		global.Promise.all([upd1.save(), upd2.save()]).then(
			function () {
				// Update one of the instances to conflict with the first one
				return upd2
					.updateOne({
						$set: { address: '123 Fake St.' },
					})
					.exec()
					.then(
						function () {
							t.fail('should not update duplicate successfully');
							t.end();
						},
						function (err) {
							assertUniqueError(
								t,
								err,
								{ address: '123 Fake St.' },
								{ address: 'Path `address` (123 Fake St.) is not unique.' },
							);

							t.end();
						},
					);
			},
			function (err) {
				t.error(err, 'should save original instances successfully');
				t.end();
			},
		);
	});
});

test('should report duplicates on fields containing spaces', function (t) {
	let SpacesSchema = new Schema({
		'display name': {
			type: String,
			unique: true,
		},
	});

	let Spaces = mongoose.model('Spaces', SpacesSchema);

	Spaces.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new Spaces({
			'display name': 'Testing display names',
		})
			.save()
			.then(
				function () {
					return new Spaces({
						'display name': 'Testing display names',
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ 'display name': 'Testing display names' },
						{
							'display name':
								'Path `display name` ' +
								'(Testing display names) is not unique.',
						},
					);
					t.end();
				},
			);
	});
});

test('should report duplicates on compound indexes', function (t) {
	let CompoundSchema = new Schema({
		name: String,
		age: Number,
	});

	CompoundSchema.index(
		{
			name: 1,
			age: 1,
		},
		{
			unique: true,
		},
	);

	let Compound = mongoose.model('Compound', CompoundSchema);

	Compound.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new Compound({
			name: 'John Doe',
			age: 42,
		})
			.save()
			.then(
				function () {
					return new Compound({
						name: 'John Doe',
						age: 42,
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{
							name: 'John Doe',
							age: 42,
						},
						{
							name: 'Path `name` (John Doe) is not unique.',
							age: 'Path `age` (42) is not unique.',
						},
					);

					t.end();
				},
			);
	});
});

test('should report duplicates on nested indexes', function (t) {
	let NestedSchema = new Schema({
		general: {
			name: {
				type: String,
				unique: true,
			},
		},
	});

	let Nested = mongoose.model('Nested', NestedSchema);

	Nested.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new Nested({
			general: {
				name: 'Test nested objects',
			},
		})
			.save()
			.then(
				function () {
					return new Nested({
						general: {
							name: 'Test nested objects',
						},
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ 'general.name': 'Test nested objects' },
						{
							'general.name':
								'Path `general.name` ' + '(Test nested objects) is not unique.',
						},
					);
					t.end();
				},
			);
	});
});

test('should use custom validation messages', function (t) {
	let MessageSchema = new Schema({
		address: {
			type: String,
			unique: 'Custom message: {PATH}!',
		},
	});

	let Message = mongoose.model('Message', MessageSchema);

	Message.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new Message({
			address: '123 Fake St.',
		})
			.save()
			.then(
				function () {
					return new Message({
						address: '123 Fake St.',
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ address: '123 Fake St.' },
						{ address: 'Custom message: address!' },
					);

					t.end();
				},
			);
	});
});

test('should allow overriding the default validation message', function (t) {
	let DefaultMessageSchema = new Schema({
		address: {
			type: String,
			unique: true,
		},
	});

	DefaultMessageSchema.plugin(beautifulValidation, {
		defaultMessage: 'Default message override test, {PATH}',
	});

	let DefaultMessage = mongoose.model('DefaultMessage', DefaultMessageSchema);

	DefaultMessage.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new DefaultMessage({
			address: '123 Fake St.',
		})
			.save()
			.then(
				function () {
					return new DefaultMessage({
						address: '123 Fake St.',
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ address: '123 Fake St.' },
						{ address: 'Default message override test, address' },
					);

					t.end();
				},
			);
	});
});

test('should use custom validation messages w/ compound', function (t) {
	let CompoundMessageSchema = new Schema({
		name: String,
		age: Number,
	});

	CompoundMessageSchema.index(
		{
			name: 1,
			age: 1,
		},
		{
			unique: 'yet another custom message',
		},
	);

	let CompoundMessage = mongoose.model(
		'CompoundMessage',
		CompoundMessageSchema,
	);

	CompoundMessage.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new CompoundMessage({
			name: 'John Doe',
			age: 42,
		})
			.save()
			.then(
				function () {
					return new CompoundMessage({
						name: 'John Doe',
						age: 42,
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{
							name: 'John Doe',
							age: 42,
						},
						{
							name: 'yet another custom message',
							age: 'yet another custom message',
						},
					);

					t.end();
				},
			);
	});
});

test('should use custom validation messages w/ nested indexes', function (t) {
	let NestedMessageSchema = new Schema({
		general: {
			name: {
				type: String,
				unique: 'nested custom validation message',
			},
		},
	});

	let NestedMessage = mongoose.model('NestedMessage', NestedMessageSchema);

	NestedMessage.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new NestedMessage({
			general: {
				name: 'Test nested objects',
			},
		})
			.save()
			.then(
				function () {
					return new NestedMessage({
						general: {
							name: 'Test nested objects',
						},
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{ 'general.name': 'Test nested objects' },
						{ 'general.name': 'nested custom validation message' },
					);
					t.end();
				},
			);
	});
});

test('should use custom messages w/ nested compound indexes', function (t) {
	let NestedCompoundMessageSchema = new Schema({
		general: {
			name: String,
			age: Number,
		},
	});

	NestedCompoundMessageSchema.index(
		{
			'general.name': 1,
			'general.age': 1,
		},
		{
			unique: 'nested compound custom validation message',
		},
	);

	let NestedCompoundMessage = mongoose.model(
		'NestedCompoundMessage',
		NestedCompoundMessageSchema,
	);

	NestedCompoundMessage.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new NestedCompoundMessage({
			general: {
				name: 'Test nested objects',
				age: 80,
			},
		})
			.save()
			.then(
				function () {
					return new NestedCompoundMessage({
						general: {
							name: 'Test nested objects',
							age: 80,
						},
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{
							'general.name': 'Test nested objects',
							'general.age': 80,
						},
						{
							'general.name': 'nested compound custom validation message',
							'general.age': 'nested compound custom validation message',
						},
					);

					t.end();
				},
			);
	});
});

test('should report duplicates on any mongoose type', function (t) {
	let AnyTypeSchema = new Schema({
		name: String,
		group: Schema.Types.ObjectId,
		age: Number,
		date: Date,
		blob: Buffer,
		isVerified: Boolean,
		list: [],
	});

	AnyTypeSchema.index(
		{
			name: 1,
			group: 1,
			age: 1,
			date: 1,
			blob: 1,
			isVerified: 1,
			list: 1,
		},
		{
			unique: true,
		},
	);

	let gid = new mongoose.Types.ObjectId();
	let date = new Date();
	let AnyType = mongoose.model('AnyType', AnyTypeSchema);

	AnyType.on('index', function (indexErr) {
		t.error(indexErr, 'indexes should be built correctly');

		new AnyType({
			name: 'test',
			group: gid,
			age: 42,
			date: date,
			blob: new Buffer('abc'),
			isVerified: false,
			list: [1, 2, 3],
		})
			.save()
			.then(
				function () {
					return new AnyType({
						name: 'test',
						group: gid,
						age: 42,
						date: date,
						blob: new Buffer('abc'),
						isVerified: false,
						list: [1, 2, 3],
					}).save();
				},
				function (err) {
					t.error(err, 'should save the first document successfully');
					t.end();
				},
			)
			.then(
				function () {
					t.fail('should not save the duplicate document successfully');
					t.end();
				},
				function (err) {
					assertUniqueError(
						t,
						err,
						{
							name: 'test',
							group: gid,
							age: 42,
							date: date,
							blob: new Buffer('abc'),
							isVerified: false,
							list: [1, 2, 3],
						},
						{
							name: 'Path `name` (test) is not unique.',
							group: 'Path `group` (' + gid.toString() + ') is not unique.',
							age: 'Path `age` (42) is not unique.',
							date: 'Path `date` (' + date.toString() + ') is not unique.',
							blob: 'Path `blob` (abc) is not unique.',
							isVerified: 'Path `isVerified` (false) is not unique.',
							list: 'Path `list` (1,2,3) is not unique.',
						},
					);

					t.end();
				},
			);
	});
});