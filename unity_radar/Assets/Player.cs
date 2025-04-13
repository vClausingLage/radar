using UnityEngine;

public class Player : MonoBehaviour
{
    private float speed = 0f;
    private readonly float rotationSpeed = 100f;

    void Update()
    {
        if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow))
        {
            speed += 5f * Time.deltaTime;
        }
        else if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow))
        {
            speed -= 15f * Time.deltaTime;
        }

        float rotation = 0f;
        if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow))
        {
            rotation = -rotationSpeed * Time.deltaTime;
        }
        else if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow))
        {
            rotation = rotationSpeed * Time.deltaTime;
        }

        transform.Translate(Vector3.up * speed * Time.deltaTime);
        transform.Rotate(0, 0, -rotation);
        
        // speed limits +/-
        speed = Mathf.Clamp(speed, -10f, 10f);
    }
}
