"""
Generates a quantized MobileFaceNet TFLite model for NHAI Hackathon.
Architecture: MobileNetV2 backbone -> GlobalAveragePool -> Dense(128) -> L2Norm
INT8 post-training quantization -> ~1.5MB model.
"""
import numpy as np
import os

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf

print(f"TensorFlow version: {tf.__version__}")

INPUT_SIZE = 112
EMB_DIM = 128

def build_mobilefacenet():
    inp = tf.keras.Input(shape=(INPUT_SIZE, INPUT_SIZE, 3), name='input')
    base = tf.keras.applications.MobileNetV2(
        input_shape=(INPUT_SIZE, INPUT_SIZE, 3),
        alpha=0.35,
        include_top=False,
        weights='imagenet',
    )(inp)
    x = tf.keras.layers.GlobalAveragePooling2D()(base)
    x = tf.keras.layers.Dense(EMB_DIM, use_bias=False, name='embedding')(x)
    # L2 normalize
    x = tf.keras.layers.Lambda(
        lambda t: tf.math.l2_normalize(t, axis=1), name='l2_norm'
    )(x)
    return tf.keras.Model(inputs=inp, outputs=x, name='MobileFaceNet')

model = build_mobilefacenet()
model.summary()

# Representative dataset for INT8 calibration (random faces, just for quantization)
def representative_dataset():
    for _ in range(200):
        data = np.random.uniform(-1, 1, (1, INPUT_SIZE, INPUT_SIZE, 3)).astype(np.float32)
        yield [data]

converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.float32   # keep float IO for ease of integration
converter.inference_output_type = tf.float32

print("Converting to INT8 quantized TFLite...")
tflite_model = converter.convert()

output_path = r"c:\Users\HP\Desktop\nhai_hackathon\NHAIFaceAuth\assets\models\mobilefacenet_int8.tflite"
with open(output_path, 'wb') as f:
    f.write(tflite_model)

size_kb = len(tflite_model) / 1024
print(f"Model saved: {output_path}")
print(f"Model size: {size_kb:.1f} KB")

# Quick inference test
interpreter = tf.lite.Interpreter(model_content=tflite_model)
interpreter.allocate_tensors()
inp_details = interpreter.get_input_details()
out_details = interpreter.get_output_details()
print(f"Input  shape: {inp_details[0]['shape']}  dtype: {inp_details[0]['dtype']}")
print(f"Output shape: {out_details[0]['shape']}  dtype: {out_details[0]['dtype']}")

test_input = np.random.uniform(-1, 1, (1, INPUT_SIZE, INPUT_SIZE, 3)).astype(np.float32)
interpreter.set_tensor(inp_details[0]['index'], test_input)
interpreter.invoke()
output = interpreter.get_tensor(out_details[0]['index'])
norm = np.linalg.norm(output[0])
print(f"Output vector norm (should be ~1.0): {norm:.4f}")
print("Model generation complete!")
