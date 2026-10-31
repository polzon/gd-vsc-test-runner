/**
 * Godot binary Variant encoding, as used by the remote debugger wire protocol
 * (`core/io/marshalls.cpp`). Only the types the debugger exchanges are covered;
 * anything else throws instead of silently decoding into the wrong shape.
 */

/** A decoded Variant. Dictionaries decode to a Map so keys keep their values. */
export type VariantValue =
    null | boolean | number | string | VariantValue[] | Map<VariantValue, VariantValue>;

const TYPE_NIL = 0;
const TYPE_BOOL = 1;
const TYPE_INT = 2;
const TYPE_FLOAT = 3;
const TYPE_STRING = 4;
const TYPE_STRING_NAME = 21;
const TYPE_DICTIONARY = 27;
const TYPE_ARRAY = 28;
const TYPE_PACKED_BYTE_ARRAY = 29;
const TYPE_PACKED_INT32_ARRAY = 30;
const TYPE_PACKED_INT64_ARRAY = 31;
const TYPE_PACKED_FLOAT32_ARRAY = 32;
const TYPE_PACKED_FLOAT64_ARRAY = 33;
const TYPE_PACKED_STRING_ARRAY = 34;
const TYPE_PACKED_VECTOR2_ARRAY = 35;
const TYPE_PACKED_VECTOR3_ARRAY = 36;
const TYPE_PACKED_COLOR_ARRAY = 37;
const TYPE_PACKED_VECTOR4_ARRAY = 38;

const HEADER_TYPE_MASK = 0xff;
const HEADER_DATA_FLAG_64 = 1 << 16;
const TYPED_ARRAY_MASK = 0b11 << 16;
const TYPED_DICTIONARY_KEY_MASK = 0b11 << 16;
const TYPED_DICTIONARY_VALUE_MASK = 0b11 << 18;
const TYPED_ARRAY_SHIFT = 16;
const TYPED_DICTIONARY_KEY_SHIFT = 16;
const TYPED_DICTIONARY_VALUE_SHIFT = 18;

const CONTAINER_KIND_NONE = 0;
const CONTAINER_KIND_BUILTIN = 1;
const CONTAINER_KIND_CLASS_NAME = 2;
const CONTAINER_KIND_SCRIPT = 3;

const MAX_DEPTH = 64;

function padding(length: number): number {
    return length % 4 === 0 ? 0 : 4 - (length % 4);
}

function concat(chunks: Buffer[]): Buffer {
    return Buffer.concat(chunks);
}

function header(type: number, flags = 0): Buffer {
    const out = Buffer.alloc(4);
    out.writeUInt32LE((type | flags) >>> 0, 0);
    return out;
}

function encodeInt(value: number): Buffer {
    if (!Number.isSafeInteger(value)) {
        throw new Error(`Cannot encode non-integer or unsafe integer as INT: ${value}`);
    }
    if (value > 0x7fffffff || value < -0x80000000) {
        const out = Buffer.alloc(12);
        header(TYPE_INT, HEADER_DATA_FLAG_64).copy(out, 0);
        out.writeBigInt64LE(BigInt(value), 4);
        return out;
    }
    const out = Buffer.alloc(8);
    header(TYPE_INT).copy(out, 0);
    out.writeInt32LE(value, 4);
    return out;
}

function encodeFloat(value: number): Buffer {
    const single = Math.fround(value);
    if (single === value) {
        const out = Buffer.alloc(8);
        header(TYPE_FLOAT).copy(out, 0);
        out.writeFloatLE(value, 4);
        return out;
    }
    const out = Buffer.alloc(12);
    header(TYPE_FLOAT, HEADER_DATA_FLAG_64).copy(out, 0);
    out.writeDoubleLE(value, 4);
    return out;
}

function encodeString(value: string): Buffer {
    const utf8 = Buffer.from(value, 'utf-8');
    const pad = Buffer.alloc(padding(utf8.length));
    return concat([header(TYPE_STRING), uint32(utf8.length), utf8, pad]);
}

function uint32(value: number): Buffer {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value >>> 0, 0);
    return out;
}

function encodeArray(values: readonly VariantValue[], depth: number): Buffer {
    const parts = [header(TYPE_ARRAY), uint32(values.length)];
    for (const value of values) {
        parts.push(encodeVariantAt(value, depth + 1));
    }
    return concat(parts);
}

function encodeDictionary(value: Map<VariantValue, VariantValue>, depth: number): Buffer {
    const parts = [header(TYPE_DICTIONARY), uint32(value.size)];
    for (const [key, entry] of value) {
        parts.push(encodeVariantAt(key, depth + 1));
        parts.push(encodeVariantAt(entry, depth + 1));
    }
    return concat(parts);
}

/** Encode one Variant. Integers use INT; everything numeric else uses FLOAT. */
export function encodeVariant(value: VariantValue): Buffer {
    return encodeVariantAt(value, 0);
}

function encodeVariantAt(value: VariantValue, depth: number): Buffer {
    if (depth > MAX_DEPTH) {
        throw new Error('Variant is too deeply nested to encode');
    }
    if (value === null) {
        return header(TYPE_NIL);
    }
    if (typeof value === 'boolean') {
        return concat([header(TYPE_BOOL), uint32(value ? 1 : 0)]);
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? encodeInt(value) : encodeFloat(value);
    }
    if (typeof value === 'string') {
        return encodeString(value);
    }
    if (Array.isArray(value)) {
        return encodeArray(value, depth);
    }
    if (value instanceof Map) {
        return encodeDictionary(value, depth);
    }
    throw new Error(`Cannot encode Variant value of type ${typeof value}`);
}

class Reader {
    offset = 0;

    constructor(private readonly buffer: Buffer) {}

    private require(bytes: number): void {
        if (this.offset + bytes > this.buffer.length) {
            throw new Error('Truncated Variant');
        }
    }

    u32(): number {
        this.require(4);
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    i32(): number {
        this.require(4);
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    i64(): number {
        this.require(8);
        const value = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return Number(value);
    }

    f32(): number {
        this.require(4);
        const value = this.buffer.readFloatLE(this.offset);
        this.offset += 4;
        return value;
    }

    f64(): number {
        this.require(8);
        const value = this.buffer.readDoubleLE(this.offset);
        this.offset += 8;
        return value;
    }

    bytes(length: number): Buffer {
        this.require(length);
        const value = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    align(): void {
        this.offset += padding(this.offset);
    }

    string(): string {
        const length = this.u32();
        const data = this.bytes(length);
        this.align();
        return new TextDecoder('utf-8').decode(data);
    }

    count(): number {
        const count = this.u32();
        if (count > this.buffer.length) {
            throw new Error(`Implausible Variant element count: ${count}`);
        }
        return count;
    }
}

function skipContainerType(reader: Reader, kind: number): void {
    switch (kind) {
        case CONTAINER_KIND_NONE:
            return;
        case CONTAINER_KIND_BUILTIN:
            reader.u32();
            return;
        case CONTAINER_KIND_CLASS_NAME:
        case CONTAINER_KIND_SCRIPT:
            reader.string();
            return;
        default:
            throw new Error(`Invalid container type kind: ${kind}`);
    }
}

function decodeValue(reader: Reader, depth: number): VariantValue {
    if (depth > MAX_DEPTH) {
        throw new Error('Variant is too deeply nested to decode');
    }
    const raw = reader.u32();
    const type = raw & HEADER_TYPE_MASK;
    const wide = (raw & HEADER_DATA_FLAG_64) !== 0;

    switch (type) {
        case TYPE_NIL:
            return null;
        case TYPE_BOOL:
            return reader.u32() !== 0;
        case TYPE_INT:
            return wide ? reader.i64() : reader.i32();
        case TYPE_FLOAT:
            return wide ? reader.f64() : reader.f32();
        case TYPE_STRING:
        case TYPE_STRING_NAME:
            return reader.string();
        case TYPE_DICTIONARY: {
            skipContainerType(
                reader,
                (raw & TYPED_DICTIONARY_KEY_MASK) >>> TYPED_DICTIONARY_KEY_SHIFT,
            );
            skipContainerType(
                reader,
                (raw & TYPED_DICTIONARY_VALUE_MASK) >>> TYPED_DICTIONARY_VALUE_SHIFT,
            );
            const count = reader.count();
            const map = new Map<VariantValue, VariantValue>();
            for (let i = 0; i < count; i++) {
                const key = decodeValue(reader, depth + 1);
                const value = decodeValue(reader, depth + 1);
                map.set(key, value);
            }
            return map;
        }
        case TYPE_ARRAY: {
            skipContainerType(reader, (raw & TYPED_ARRAY_MASK) >>> TYPED_ARRAY_SHIFT);
            const count = reader.count();
            const values: VariantValue[] = [];
            for (let i = 0; i < count; i++) {
                values.push(decodeValue(reader, depth + 1));
            }
            return values;
        }
        case TYPE_PACKED_BYTE_ARRAY: {
            const count = reader.count();
            const values = [...reader.bytes(count)];
            reader.align();
            return values;
        }
        case TYPE_PACKED_INT32_ARRAY: {
            const count = reader.count();
            const values: number[] = [];
            for (let i = 0; i < count; i++) {
                values.push(reader.i32());
            }
            return values;
        }
        case TYPE_PACKED_INT64_ARRAY: {
            const count = reader.count();
            const values: number[] = [];
            for (let i = 0; i < count; i++) {
                values.push(reader.i64());
            }
            return values;
        }
        case TYPE_PACKED_FLOAT32_ARRAY: {
            const count = reader.count();
            const values: number[] = [];
            for (let i = 0; i < count; i++) {
                values.push(reader.f32());
            }
            return values;
        }
        case TYPE_PACKED_FLOAT64_ARRAY: {
            const count = reader.count();
            const values: number[] = [];
            for (let i = 0; i < count; i++) {
                values.push(reader.f64());
            }
            return values;
        }
        case TYPE_PACKED_STRING_ARRAY: {
            const count = reader.count();
            const values: string[] = [];
            for (let i = 0; i < count; i++) {
                values.push(reader.string());
            }
            return values;
        }
        case TYPE_PACKED_VECTOR2_ARRAY:
        case TYPE_PACKED_VECTOR3_ARRAY:
        case TYPE_PACKED_VECTOR4_ARRAY: {
            const width = type - TYPE_PACKED_VECTOR2_ARRAY + 2;
            return decodePackedVectors(reader, width, wide);
        }
        case TYPE_PACKED_COLOR_ARRAY: {
            const count = reader.count();
            const values: number[][] = [];
            for (let i = 0; i < count; i++) {
                values.push([reader.f32(), reader.f32(), reader.f32(), reader.f32()]);
            }
            return values;
        }
        default:
            throw new Error(`Unsupported Variant type: ${type}`);
    }
}

function decodePackedVectors(reader: Reader, width: number, wide: boolean): number[][] {
    const count = reader.count();
    const values: number[][] = [];
    for (let i = 0; i < count; i++) {
        const vector: number[] = [];
        for (let j = 0; j < width; j++) {
            vector.push(wide ? reader.f64() : reader.f32());
        }
        values.push(vector);
    }
    return values;
}

/** Decode exactly one Variant. Trailing bytes are rejected as malformed. */
export function decodeVariant(buffer: Buffer): VariantValue {
    const reader = new Reader(buffer);
    const value = decodeValue(reader, 0);
    if (reader.offset !== buffer.length) {
        throw new Error(`Variant left ${buffer.length - reader.offset} trailing bytes`);
    }
    return value;
}
